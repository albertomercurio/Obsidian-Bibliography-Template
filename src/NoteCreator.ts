import { App, Notice, normalizePath, TFile } from "obsidian";
import type { PaperMetadata } from "./types";
import type { PluginSettings } from "./types";
import { VaultIndex } from "./VaultIndex";
import { mergedFields, valueOf, type MergeField } from "./AuthorMerge";

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

  // --------------------------------------------------------------------------
  // Template handling
  // --------------------------------------------------------------------------

  /**
   * Reads a template file's content and returns it as a string.
   * Falls back to a minimal stub if the template cannot be found.
   */
  private async templateContent(templateBasename: string): Promise<string> {
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
        if (value !== (fm[field.key] ?? "")) fm[field.key] = value;
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
  }): Promise<string> {
    const safeName = this.personBasename(params);
    const folder = this.settings.peopleFolder;
    await this.ensureFolder(folder);
    const filePath = normalizePath(`${folder}/${safeName}.md`);

    // If file already exists, don't overwrite
    if (this.app.vault.getAbstractFileByPath(filePath)) {
      return safeName;
    }

    const file = await this.app.vault.create(
      filePath,
      await this.templateContent("Person Template")
    );
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm["type"] = "Person";
      fm["first_name"] = params.given;
      fm["last_name"] = params.family;
      fm["ORCiD"] = params.orcid ?? "";
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

    const file = await this.app.vault.create(
      filePath,
      await this.templateContent("Journal Template")
    );
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm["type"] = "Journal";
      fm["full_name"] = params.fullName;
      fm["aliases"] = aliases.length ? aliases : null;
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
  }): Promise<TFile> {
    const { metadata, bibtex, authorNames, journalName } = params;
    const firstFamily =
      metadata.authors[0]?.family ?? "";
    const filename = articleFilename(metadata, firstFamily);
    const folder = this.settings.articlesFolder;
    await this.ensureFolder(folder);
    const filePath = normalizePath(`${folder}/${filename}.md`);

    const authorLinks = authorNames.map(wikilink);
    const journalLink = journalName ? wikilink(journalName) : null;

    let content = await this.templateContent("Article Template");
    if (metadata.abstract) {
      // Match the Abstract heading, consume its trailing newline and ALL
      // subsequent blank lines from the template, then insert exactly one
      // blank line before the abstract text.
      content = content.replace(
        /^(#{1,6}\s+Abstract)\s*\n(\s*\n)*/im,
        `$1\n\n${metadata.abstract}\n\n`
      );
    }

    const file = await this.app.vault.create(filePath, content);
    await this.app.fileManager.processFrontMatter(file, (fm) => {
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
    });

    this.index.indexFile(file);
    return file;
  }

  // --------------------------------------------------------------------------
  // Book note
  // --------------------------------------------------------------------------

  async createBook(params: {
    metadata: PaperMetadata;
    bibtex: string;
    authorNames: string[];
  }): Promise<TFile> {
    const { metadata, bibtex, authorNames } = params;
    const firstFamily = metadata.authors[0]?.family ?? "";
    const filename = articleFilename(metadata, firstFamily);
    const folder = this.settings.booksFolder;
    await this.ensureFolder(folder);
    const filePath = normalizePath(`${folder}/${filename}.md`);

    const authorLinks = authorNames.map(wikilink);

    const file = await this.app.vault.create(
      filePath,
      await this.templateContent("Book Template")
    );
    await this.app.fileManager.processFrontMatter(file, (fm) => {
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
