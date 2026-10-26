import { App, Notice, normalizePath, TFile } from "obsidian";
import type { PaperMetadata } from "./types";
import type { PluginSettings } from "./types";
import { VaultIndex } from "./VaultIndex";
import { mergedFields, valueOf, type MergeField, type PersonFieldKey } from "./AuthorMerge";
import { abstractCallout, bibtexSection, profileFor, setSection, type Provenance, type SchemaProfile } from "./schema";

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

  get profile(): SchemaProfile {
    return profileFor(this.settings.schemaProfile);
  }

  /** Property name of a logical person field in the active profile. */
  private personKey(field: PersonFieldKey): string {
    const k = this.profile.keys;
    return field === "given" ? k.firstName : field === "family" ? k.lastName : k.orcid;
  }

  // --------------------------------------------------------------------------
  // Template handling
  // --------------------------------------------------------------------------

  /**
   * Reads a template file's content and returns it as a string.
   * Falls back to a minimal stub if the template cannot be found.
   */
  private async templateContent(kind: "article" | "book" | "person" | "journal"): Promise<string> {
    const builtIn = this.profile.bodies?.[kind];
    if (builtIn !== undefined) return builtIn;
    const templateBasename = this.profile.templateNames[kind];
    const templateFile = this.app.vault.getMarkdownFiles().find(
      (f) =>
        f.basename === templateBasename &&
        f.path.toLowerCase().includes("template")
    );
    if (!templateFile) return "---\n---\n\n## Notes\n";
    return await this.app.vault.read(templateFile);
  }

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
        const key = this.personKey(field.key);
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
   * Creates a minimal Person stub. Returns the display name (used as wikilink).
   * If the file already exists, returns the existing basename.
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

    const p = this.profile;
    let body = await this.templateContent("person");
    if (p.bodies && params.provenance) {
      const { source, ident, date } = params.provenance;
      body = setSection(body, "Sources", `- Created on ${date} from the ${source} record of ${ident}.`);
    }
    const file = await this.app.vault.create(filePath, body);
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm[p.keys.type] = p.types.person;
      fm[p.keys.firstName] = params.given;
      fm[p.keys.lastName] = params.family;
      fm[p.keys.orcid] = params.orcid ?? (p.bodies ? null : "");
      if (p.keys.email) fm[p.keys.email] = null;
      if (p.keys.affiliations) fm[p.keys.affiliations] = null;
      // A person created from a paper is known only as an author, not as a collaborator.
      if (p.keys.relationship) fm[p.keys.relationship] = ["Author"];
    });

    this.index.indexFile(file);
    return safeName;
  }

  // --------------------------------------------------------------------------
  // Journal note
  // --------------------------------------------------------------------------

  /**
   * Creates a Journal note. Returns the display name used as wikilink.
   * Uses full_name as filename; stores abbreviation in aliases.
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

    const aliases: string[] =
      params.shortName && params.shortName !== params.fullName
        ? [params.shortName]
        : [];

    const p = this.profile;
    const file = await this.app.vault.create(filePath, await this.templateContent("journal"));
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm[p.keys.type] = p.types.journal;
      if (p.keys.journalFullName) fm[p.keys.journalFullName] = params.fullName;
      if (p.keys.journalAbbreviation) {
        // The abbreviation is what BibTeX uses; keep it in its own property.
        fm[p.keys.journalAbbreviation] = params.shortName ?? null;
      } else {
        fm[p.keys.aliases] = aliases.length ? aliases : null;
      }
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
    const p = this.profile;
    const firstFamily =
      metadata.authors[0]?.family ?? "";
    const filename = articleFilename(metadata, firstFamily);
    const folder = this.settings.articlesFolder;
    await this.ensureFolder(folder);
    const filePath = normalizePath(`${folder}/${filename}.md`);

    const authorLinks = authorNames.map(wikilink);
    const journalLink = journalName ? wikilink(journalName) : null;

    let content = await this.templateContent("article");
    if (p.bodies) {
      content = setSection(content, "Abstract", abstractCallout(metadata.abstract, provenance));
      const extra = params.totalAuthors && params.totalAuthors > authorNames.length
        ? [`Only the first of ${params.totalAuthors} authors is linked in Authors; the full list is in the entry below.`]
        : [];
      content = setSection(content, "BibTeX", bibtexSection(bibtex, provenance, extra));
    } else if (metadata.abstract) {
      // Match the Abstract heading, consume its trailing newline and ALL
      // subsequent blank lines from the template, then insert exactly one
      // blank line before the abstract text.
      // A replacer function is used (not a replacement string) so that `$`
      // sequences in the abstract's LaTeX (e.g. `$1.0 \times 10^{-21}$`,
      // `$$...$$`) are inserted literally instead of being interpreted as
      // `$1`, `$2`, `$$`, `$&` replacement patterns.
      const abstract = metadata.abstract;
      content = content.replace(
        /^(#{1,6}\s+Abstract)\s*\n(\s*\n)*/im,
        (_match, heading: string) => `${heading}\n\n${abstract}\n\n`
      );
    }

    const file = await this.app.vault.create(filePath, content);
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (!p.bodies) {
        // Legacy layout, unchanged.
        fm["type"] = "Article";
        fm["doi"] = metadata.doi ?? null;
        fm["arxiv_id"] = metadata.arxivId ?? null;
        fm["title"] = metadata.title;
        fm["authors"] = authorLinks;
        fm["journal"] = journalLink;
        fm["year"] = metadata.year > 0 ? metadata.year : null;
        fm["url"] = metadata.url ?? null;
        fm["read"] = false;
        fm["bibtex"] = bibtex;
        return;
      }
      const k = p.keys;
      fm[k.type] = p.types.article;
      fm[k.title] = metadata.title;
      fm[k.authors] = authorLinks;
      fm[k.journal] = journalLink;
      fm[k.year] = metadata.year > 0 ? metadata.year : null;
      if (metadata.doi) fm[k.doi] = metadata.doi;
      if (metadata.arxivId) fm[k.arxiv] = metadata.arxivId;
      if (metadata.url && !(p.urlOnlyWithoutDoi && metadata.doi)) fm[k.url] = metadata.url;
      fm[k.pdf] = null;
      fm[k.read] = false;
      if (k.topics) fm[k.topics] = null;
    });

    this.index.indexFile(file);
    return file;
  }

  // --------------------------------------------------------------------------
  // BibTeX location
  // --------------------------------------------------------------------------

  /**
   * Writes a BibTeX entry where the active profile keeps it: a property or the
   * note body. With a provenance the source callout is rewritten (the entry was
   * just checked against the source); without one only the entry changes.
   */
  async writeBibtex(file: TFile, bibtex: string, provenance: Provenance | null): Promise<void> {
    const property = this.profile.bibtexProperty;
    if (property) {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm[property] = bibtex;
      });
      return;
    }
    await this.app.vault.process(file, (text) => {
      if (provenance) return setSection(text, "BibTeX", bibtexSection(bibtex, provenance));
      const block = /```bibtex[ \t]*\n[\s\S]*?\n```/;
      const fenced = "```bibtex\n" + bibtex.trim() + "\n```";
      return block.test(text) ? text.replace(block, () => fenced) : setSection(text, "BibTeX", fenced);
    });
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
    const p = this.profile;
    const firstFamily = metadata.authors[0]?.family ?? "";
    const filename = articleFilename(metadata, firstFamily);
    const folder = this.settings.booksFolder;
    await this.ensureFolder(folder);
    const filePath = normalizePath(`${folder}/${filename}.md`);

    const authorLinks = authorNames.map(wikilink);

    let content = await this.templateContent("book");
    if (p.bodies) content = setSection(content, "BibTeX", bibtexSection(bibtex, provenance));
    const file = await this.app.vault.create(filePath, content);
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (p.bodies) {
        const k = p.keys;
        fm[k.type] = p.types.book;
        fm[k.title] = metadata.title;
        fm[k.authors] = authorLinks;
        fm[k.publisher] = metadata.publisher ?? null;
        fm[k.year] = metadata.year > 0 ? metadata.year : null;
        fm[k.isbn] = metadata.isbn ?? null;
        if (metadata.doi) fm[k.doi] = metadata.doi;
        fm[k.pdf] = null;
        fm[k.read] = false;
        if (k.topics) fm[k.topics] = null;
        return;
      }
      fm["type"] = "Book";
      fm["isbn"] = metadata.isbn ?? null;
      fm["title"] = metadata.title;
      fm["authors"] = authorLinks;
      fm["publisher"] = metadata.publisher ?? null;
      fm["year"] = metadata.year > 0 ? metadata.year : null;
      fm["url"] = metadata.url ?? null;
      fm["read"] = false;
      fm["bibtex"] = bibtex;
    });

    this.index.indexFile(file);
    return file;
  }
}
