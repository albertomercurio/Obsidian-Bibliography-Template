import type { Frontmatter, NoteRef, Ui, VaultPort } from "./ports";
import type { PaperMetadata, PluginSettings } from "./types";
import { VaultIndex } from "./VaultIndex";
import { mergedFields, valueOf, type MergeField, type PersonFieldKey } from "./AuthorMerge";
import { abstractCallout, DEFAULT_TEMPLATES, parseTemplate, PROP, setSection, TYPES, type NoteTemplate, type Provenance } from "./schema";

// ---------------------------------------------------------------------------
// Filename sanitisation
// ---------------------------------------------------------------------------

export function sanitizeFilename(s: string, maxLen = 80): string {
  return s
    .replace(/[\\/:*?"<>|#^[\]]/g, " ") // forbidden chars
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, maxLen)
    .trim();
}

function articleFilename(metadata: PaperMetadata, firstAuthorFamily: string): string {
  const fallbackLabel = metadata.itemType === "book" ? metadata.publisher ?? "Book" : "Unknown";
  const surname = sanitizeFilename(firstAuthorFamily || fallbackLabel, 40);
  const year = metadata.year > 0 ? String(metadata.year) : "XXXX";
  const title = sanitizeFilename(metadata.title, 120);
  return `${surname} - ${year} - ${title}`;
}

// Produces the wikilink syntax, e.g. "[[Alberto Mercurio]]"
function wikilink(name: string): string {
  return `[[${name}]]`;
}

function joinPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
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
    private vault: VaultPort,
    private settings: PluginSettings,
    private ui: Ui,
    private index: VaultIndex
  ) {}

  private folderOf(type: string): string {
    const { articlesFolder, booksFolder, peopleFolder, journalsFolder, publishersFolder } = this.settings;
    return { [TYPES.article]: articlesFolder, [TYPES.book]: booksFolder, [TYPES.person]: peopleFolder, [TYPES.journal]: journalsFolder, [TYPES.publisher]: publishersFolder }[type] ?? "";
  }

  private async templateOf(type: string): Promise<NoteTemplate> {
    const path = joinPath(this.settings.templatesFolder, `${type}.md`);
    return this.settings.templatesFolder && this.vault.exists(path)
      ? parseTemplate(await this.vault.read(path))
      : DEFAULT_TEMPLATES[type];
  }

  /** Creates a note with the properties of its template, in order, empty when unknown. */
  private async createTyped(type: string, basename: string, values: Frontmatter, fillBody: (body: string) => string = (b) => b): Promise<NoteRef> {
    const { keys, body } = await this.templateOf(type);
    const folder = this.folderOf(type);
    await this.vault.ensureFolder(folder);
    const file = await this.vault.create(joinPath(folder, `${basename}.md`), fillBody(body));
    await this.vault.processFrontMatter(file.path, (fm) => {
      fm[PROP.type] = type;
      for (const key of keys) fm[key] = values[key] ?? null;
      Object.assign(fm, values);
    });
    this.index.indexFile(file);
    return file;
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

  planMergePerson(file: NoteRef, fields: MergeField[]): PlannedNoteAction<string> {
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
  private personPathTaken(file: NoteRef, basename: string): boolean {
    const sibling = this.siblingPath(file, basename);
    return sibling.toLowerCase() !== file.path.toLowerCase() && this.vault.exists(sibling);
  }

  private siblingPath(file: NoteRef, basename: string): string {
    const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
    return joinPath(dir, `${basename}.md`);
  }

  /** A note for a publisher not yet in the vault, named as the source names it. */
  planCreatePublisher(name: string): PlannedNoteAction<string> {
    const basename = sanitizeFilename(name, 120);
    return {
      basename,
      commit: async () => {
        if (!this.vault.exists(joinPath(this.folderOf(TYPES.publisher), `${basename}.md`))) await this.createTyped(TYPES.publisher, basename, {});
        return basename;
      },
    };
  }

  planCreateJournal(params: { fullName: string; shortName?: string; publisherName?: string }): PlannedNoteAction<string> {
    return {
      basename: this.journalBasename(params),
      commit: () => this.createJournal(params),
    };
  }

  publicationPath(metadata: PaperMetadata): string {
    const firstFamily = metadata.authors[0]?.family ?? "";
    const folder = this.folderOf(metadata.itemType === "book" ? TYPES.book : TYPES.article);
    return joinPath(folder, `${articleFilename(metadata, firstFamily)}.md`);
  }

  publicationFileExists(metadata: PaperMetadata): boolean {
    return this.vault.exists(this.publicationPath(metadata));
  }

  // --------------------------------------------------------------------------
  // Person merge
  // --------------------------------------------------------------------------

  /**
   * Writes the resolved value of each field onto an existing Person note,
   * touching only the keys that actually change so the note body and any
   * user-added frontmatter are left alone. Refreshes the index.
   */
  async applyPersonFields(file: NoteRef, fields: MergeField[]): Promise<void> {
    const changes = fields.filter((f) => !f.identical);
    if (changes.length === 0) return;

    await this.vault.processFrontMatter(file.path, (fm) => {
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
   * the resolved display name differs from the current one; the host updates
   * every link. Returns the (possibly new) file basename.
   */
  async mergePerson(file: NoteRef, fields: MergeField[]): Promise<string> {
    await this.applyPersonFields(file, fields);

    const newBasename = this.personBasename(mergedFields(fields));
    if (!newBasename || newBasename === file.basename) {
      return file.basename;
    }

    // Another Person note already sits at the target name. Renaming would
    // throw, so keep the frontmatter update and leave the filename alone.
    if (this.personPathTaken(file, newBasename)) {
      this.ui.notice(`Updated "${file.basename}" but kept its filename — "${newBasename}" already exists.`, 7000);
      return file.basename;
    }

    const renamed = await this.vault.rename(file.path, this.siblingPath(file, newBasename));
    if (!renamed) {
      this.ui.notice(`Updated "${file.basename}"; rename it to "${newBasename}" from Obsidian.`, 7000);
      return file.basename;
    }
    this.index.renameFile(file.path, renamed);
    return renamed.basename;
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
    if (this.vault.exists(joinPath(this.folderOf(TYPES.person), `${safeName}.md`))) return safeName;

    const { provenance } = params;
    await this.createTyped(TYPES.person, safeName, {
      [PROP.firstName]: params.given,
      [PROP.lastName]: params.family,
      [PROP.orcid]: params.orcid ?? null,
      // A person created from a paper is known only as an author, not as a collaborator.
      [PROP.relationship]: ["Author"],
    }, (body) => provenance
      ? setSection(body, "Sources", `- Created on ${provenance.date} from the ${provenance.source} record of ${provenance.ident}.`)
      : body);
    return safeName;
  }

  // --------------------------------------------------------------------------
  // Journal note
  // --------------------------------------------------------------------------

  /**
   * Creates a Journal note named after the full title. The abbreviation, used
   * in BibTeX, goes in its own property. Returns the display name.
   */
  async createJournal(params: { fullName: string; shortName?: string; publisherName?: string }): Promise<string> {
    const safeName = this.journalBasename(params);
    if (this.vault.exists(joinPath(this.folderOf(TYPES.journal), `${safeName}.md`))) return safeName;
    await this.createTyped(TYPES.journal, safeName, {
      [PROP.abbreviation]: params.shortName ?? null,
      ...(params.publisherName ? { [PROP.publisher]: wikilink(params.publisherName) } : {}),
    });
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
    topics?: string[];
  }): Promise<NoteRef> {
    const { metadata, bibtex, authorNames, journalName, provenance } = params;
    const path = this.publicationPath(metadata);
    const basename = path.slice(path.lastIndexOf("/") + 1, -3);

    const extra = params.totalAuthors && params.totalAuthors > authorNames.length
      ? [`Only the first of ${params.totalAuthors} authors is linked in Authors; the full list is in BibTeX.`]
      : [];
    return this.createTyped(TYPES.article, basename, {
      [PROP.title]: metadata.title,
      [PROP.authors]: authorNames.map(wikilink),
      [PROP.journal]: journalName ? wikilink(journalName) : null,
      [PROP.year]: metadata.year > 0 ? metadata.year : null,
      [PROP.doi]: metadata.doi ?? null,
      [PROP.arxiv]: metadata.arxivId ?? null,
      ...(metadata.url && !metadata.doi ? { [PROP.url]: metadata.url } : {}),
      [PROP.read]: false,
      [PROP.topics]: params.topics?.length ? params.topics.map(wikilink) : null,
      [PROP.bibtex]: bibtex,
    }, (body) => setSection(body, "Abstract", abstractCallout(metadata.abstract, provenance, extra)));
  }

  // --------------------------------------------------------------------------
  // BibTeX
  // --------------------------------------------------------------------------

  /** Writes a BibTeX entry into the note's `BibTeX` property. */
  async writeBibtex(file: NoteRef, bibtex: string): Promise<void> {
    await this.vault.processFrontMatter(file.path, (fm) => {
      fm[PROP.bibtex] = bibtex;
    });
    this.index.indexFile(file);
  }

  // --------------------------------------------------------------------------
  // Book note
  // --------------------------------------------------------------------------

  async createBook(params: {
    metadata: PaperMetadata;
    bibtex: string;
    authorNames: string[];
    /** Display name of the publisher note; without it, the publisher as text. */
    publisherName?: string;
    provenance: Provenance;
    topics?: string[];
  }): Promise<NoteRef> {
    const { metadata, bibtex, authorNames } = params;
    const path = this.publicationPath(metadata);
    const basename = path.slice(path.lastIndexOf("/") + 1, -3);
    return this.createTyped(TYPES.book, basename, {
      [PROP.title]: metadata.title,
      [PROP.authors]: authorNames.map(wikilink),
      [PROP.publisher]: params.publisherName ? wikilink(params.publisherName) : metadata.publisher ?? null,
      [PROP.year]: metadata.year > 0 ? metadata.year : null,
      [PROP.isbn]: metadata.isbn ?? null,
      [PROP.doi]: metadata.doi ?? null,
      [PROP.read]: false,
      [PROP.topics]: params.topics?.length ? params.topics.map(wikilink) : null,
      [PROP.bibtex]: bibtex,
    });
  }
}
