import { App, Notice, normalizePath, TFile } from "obsidian";
import type { PaperMetadata } from "./types";
import type { PluginSettings } from "./types";
import { VaultIndex } from "./VaultIndex";
import { mergedFields, valueOf, type MergeField, type PersonFieldKey } from "./AuthorMerge";
import {
  abstractCallout,
  BODIES,
  bibtexSection,
  PROP,
  replaceBibtexBlock,
  setSection,
  TYPES,
  type Provenance,
} from "./schema";

// ---------------------------------------------------------------------------
// Filename sanitisation
// ---------------------------------------------------------------------------

function sanitizeFilename(s: string, maxLen = 80): string {
  return s
    .replace(/[\\/:*?"<>|#^[\]]/g, " ") // forbidden chars
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, maxLen)
    .trim();
}

function articleFilename(
  metadata: PaperMetadata,
  firstAuthorFamily: string
): string {
  const fallbackLabel =
    metadata.itemType === "book"
      ? metadata.publisher ?? "Book"
      : "Unknown";
  const surname = sanitizeFilename(firstAuthorFamily || fallbackLabel, 40);
  const year = metadata.year > 0 ? String(metadata.year) : "XXXX";
  const title = sanitizeFilename(metadata.title, 120);
  return `${surname} - ${year} - ${title}`;
}

// Produces the wikilink syntax, e.g. "[[Alberto Mercurio]]"
function wikilink(name: string): string {
  return `[[${name}]]`;
}

const PERSON_KEYS: Record<PersonFieldKey, string> = {
  given: PROP.firstName,
  family: PROP.lastName,
  orcid: PROP.orcid,
};

export interface PlannedNoteAction<T> {
  basename: string;
  commit: () => Promise<T>;
}

// ---------------------------------------------------------------------------
// NoteCreator
// ---------------------------------------------------------------------------

export class NoteCreator {
  constructor(
    private app: App,
    private settings: PluginSettings,
    private index: VaultIndex
  ) {}

  async ensureFolder(folderPath: string): Promise<void> {
    const norm = normalizePath(folderPath);
    if (!this.app.vault.getAbstractFileByPath(norm)) {
      await this.app.vault.createFolder(norm);
    }
  }

  personBasename(params: { given: string; family: string }): string {
    return sanitizeFilename(`${params.given} ${params.family}`.trim(), 100);
  }

  journalBasename(params: { fullName: string }): string {
    return sanitizeFilename(params.fullName, 120);
  }

  planCreatePerson(params: {
    given: string;
    family: string;
    orcid?: string;
    provenance?: Provenance;
  }): PlannedNoteAction<string> {
    return {
      basename: this.personBasename(params),
      commit: () => this.createPerson(params),
    };
  }

  planMergePerson(file: TFile, fields: MergeField[]): PlannedNoteAction<string> {
    const merged = mergedFields(fields);
    const target = this.personBasename(merged);
    // The caller writes wikilinks from `basename` before commit() runs, so a
    // rename that will be blocked must be predicted here, not discovered later.
    const renamable = target && !this.personPathTaken(file, target);
    return {
      basename: renamable ? target : file.basename,
      commit: () => this.mergePerson(file, fields),
    };
  }

  /** True when another file already occupies `basename` next to `file`. */
  private personPathTaken(file: TFile, basename: string): boolean {
    const occupant = this.app.vault.getAbstractFileByPath(
      this.siblingPath(file, basename)
    );
    return Boolean(occupant) && occupant !== file;
  }

  private siblingPath(file: TFile, basename: string): string {
    const dir = file.parent?.path ?? "";
    return normalizePath(dir ? `${dir}/${basename}.md` : `${basename}.md`);
  }

  planCreateJournal(params: {
    fullName: string;
    shortName?: string;
  }): PlannedNoteAction<string> {
    return {
      basename: this.journalBasename(params),
      commit: () => this.createJournal(params),
    };
  }

  publicationFileExists(metadata: PaperMetadata): boolean {
    const firstFamily = metadata.authors[0]?.family ?? "";
    const filename = articleFilename(metadata, firstFamily);
    const folder = metadata.itemType === "book"
      ? this.settings.booksFolder
      : this.settings.articlesFolder;
    const filePath = normalizePath(`${folder}/${filename}.md`);
    return Boolean(this.app.vault.getAbstractFileByPath(filePath));
  }

  // --------------------------------------------------------------------------
  // Person merge
  // --------------------------------------------------------------------------

  /**
   * Writes the resolved value of each field onto an existing Person note,
   * touching only the keys that actually change so the note body and any
   * user-added frontmatter are left alone. Refreshes the index.
   */
  async applyPersonFields(file: TFile, fields: MergeField[]): Promise<void> {
    const changes = fields.filter((f) => !f.identical);
    if (changes.length === 0) return;

    await this.app.fileManager.processFrontMatter(file, (fm) => {
      for (const field of changes) {
        const value = valueOf(field);
        const key = PERSON_KEYS[field.key];
        if (value !== (fm[key] ?? "")) fm[key] = value;
      }
    });
    this.index.indexFile(file);
  }

  /**
   * Applies a merge plan to an existing Person note and renames the file when
   * the resolved display name differs from the current one. Obsidian's rename
   * API automatically updates all wikilinks in the vault.
   * Returns the (possibly new) file basename.
   */
  async mergePerson(file: TFile, fields: MergeField[]): Promise<string> {
    await this.applyPersonFields(file, fields);

    const newBasename = this.personBasename(mergedFields(fields));
    if (!newBasename || newBasename === file.basename) {
      return file.basename;
    }

    // Another Person note already sits at the target name. Renaming would
    // throw, so keep the frontmatter update and leave the filename alone.
    if (this.personPathTaken(file, newBasename)) {
      new Notice(
        `Updated "${file.basename}" but kept its filename — "${newBasename}" already exists.`,
        7000
      );
      return file.basename;
    }

    const newPath = this.siblingPath(file, newBasename);
    await this.app.fileManager.renameFile(file, newPath);
    const renamed = this.app.vault.getAbstractFileByPath(newPath);
    if (renamed instanceof TFile) {
      this.index.indexFile(renamed);
      return renamed.basename;
    }

    return file.basename;
  }

  // --------------------------------------------------------------------------
  // Person note
  // --------------------------------------------------------------------------

  /**
   * Creates a Person note for an author. Returns the display name (used as
   * wikilink). If the file already exists, returns the existing basename.
   */
  async createPerson(params: {
    given: string;
    family: string;
    orcid?: string;
    provenance?: Provenance;
  }): Promise<string> {
    const safeName = this.personBasename(params);
    const folder = this.settings.peopleFolder;
    await this.ensureFolder(folder);
    const filePath = normalizePath(`${folder}/${safeName}.md`);

    // If file already exists, don't overwrite
    if (this.app.vault.getAbstractFileByPath(filePath)) {
      return safeName;
    }

    let body = BODIES.person;
    if (params.provenance) {
      const { source, ident, date } = params.provenance;
      body = setSection(body, "Sources", `- Created on ${date} from the ${source} record of ${ident}.`);
    }
    const file = await this.app.vault.create(filePath, body);
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm[PROP.type] = TYPES.person;
      fm[PROP.firstName] = params.given;
      fm[PROP.lastName] = params.family;
      fm[PROP.orcid] = params.orcid ?? null;
      fm[PROP.email] = null;
      fm[PROP.affiliations] = null;
      // A person created from a paper is known only as an author, not as a collaborator.
      fm[PROP.relationship] = ["Author"];
    });

    this.index.indexFile(file);
    return safeName;
  }

  // --------------------------------------------------------------------------
  // Journal note
  // --------------------------------------------------------------------------

  /**
   * Creates a Journal note named after the full title. The abbreviation, used
   * in BibTeX, goes in its own property. Returns the display name.
   */
  async createJournal(params: {
    fullName: string;
    shortName?: string;
  }): Promise<string> {
    const safeName = this.journalBasename(params);
    const folder = this.settings.journalsFolder;
    await this.ensureFolder(folder);
    const filePath = normalizePath(`${folder}/${safeName}.md`);

    if (this.app.vault.getAbstractFileByPath(filePath)) {
      return safeName;
    }

    const file = await this.app.vault.create(filePath, BODIES.journal);
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm[PROP.type] = TYPES.journal;
      fm[PROP.abbreviation] = params.shortName ?? null;
    });

    this.index.indexFile(file);
    return safeName;
  }

  // --------------------------------------------------------------------------
  // Article note
  // --------------------------------------------------------------------------

  async createArticle(params: {
    metadata: PaperMetadata;
    bibtex: string;
    /** Display names (file basenames) for each author, in order */
    authorNames: string[];
    /** Display name (file basename) of the journal, or undefined */
    journalName?: string;
    provenance: Provenance;
    /** Total number of authors when only some are linked. */
    totalAuthors?: number;
  }): Promise<TFile> {
    const { metadata, bibtex, authorNames, journalName, provenance } = params;
    const firstFamily = metadata.authors[0]?.family ?? "";
    const filename = articleFilename(metadata, firstFamily);
    const folder = this.settings.articlesFolder;
    await this.ensureFolder(folder);
    const filePath = normalizePath(`${folder}/${filename}.md`);

    const extra = params.totalAuthors && params.totalAuthors > authorNames.length
      ? [`Only the first of ${params.totalAuthors} authors is linked in Authors; the full list is in the entry below.`]
      : [];
    let content = setSection(BODIES.article, "Abstract", abstractCallout(metadata.abstract, provenance));
    content = setSection(content, "BibTeX", bibtexSection(bibtex, provenance, extra));

    const file = await this.app.vault.create(filePath, content);
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm[PROP.type] = TYPES.article;
      fm[PROP.title] = metadata.title;
      fm[PROP.authors] = authorNames.map(wikilink);
      fm[PROP.journal] = journalName ? wikilink(journalName) : null;
      fm[PROP.year] = metadata.year > 0 ? metadata.year : null;
      if (metadata.doi) fm[PROP.doi] = metadata.doi;
      if (metadata.arxivId) fm[PROP.arxiv] = metadata.arxivId;
      if (metadata.url && !metadata.doi) fm[PROP.url] = metadata.url;
      fm[PROP.pdf] = null;
      fm[PROP.read] = false;
      fm[PROP.topics] = null;
    });

    this.index.indexFile(file);
    return file;
  }

  // --------------------------------------------------------------------------
  // BibTeX
  // --------------------------------------------------------------------------

  /**
   * Writes a BibTeX entry into the note's `## BibTeX` section. With a
   * provenance the source line is rewritten (the entry was just checked against
   * the source); without one only the entry changes.
   */
  async writeBibtex(file: TFile, bibtex: string, provenance: Provenance | null): Promise<void> {
    await this.app.vault.process(file, (text) =>
      provenance ? setSection(text, "BibTeX", bibtexSection(bibtex, provenance)) : replaceBibtexBlock(text, bibtex)
    );
  }

  // --------------------------------------------------------------------------
  // Book note
  // --------------------------------------------------------------------------

  async createBook(params: {
    metadata: PaperMetadata;
    bibtex: string;
    authorNames: string[];
    provenance: Provenance;
  }): Promise<TFile> {
    const { metadata, bibtex, authorNames, provenance } = params;
    const firstFamily = metadata.authors[0]?.family ?? "";
    const filename = articleFilename(metadata, firstFamily);
    const folder = this.settings.booksFolder;
    await this.ensureFolder(folder);
    const filePath = normalizePath(`${folder}/${filename}.md`);

    const content = setSection(BODIES.book, "BibTeX", bibtexSection(bibtex, provenance));
    const file = await this.app.vault.create(filePath, content);
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm[PROP.type] = TYPES.book;
      fm[PROP.title] = metadata.title;
      fm[PROP.authors] = authorNames.map(wikilink);
      fm[PROP.publisher] = metadata.publisher ?? null;
      fm[PROP.year] = metadata.year > 0 ? metadata.year : null;
      fm[PROP.isbn] = metadata.isbn ?? null;
      if (metadata.doi) fm[PROP.doi] = metadata.doi;
      fm[PROP.pdf] = null;
      fm[PROP.read] = false;
      fm[PROP.topics] = null;
    });

    this.index.indexFile(file);
    return file;
  }
}
