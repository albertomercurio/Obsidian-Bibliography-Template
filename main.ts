import { App, Notice, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, ResearchImporterSettingTab } from "./src/settings";
import type { PluginSettings } from "./src/types";
import { VaultIndex } from "./src/VaultIndex";
import { NoteCreator } from "./src/NoteCreator";
import { ImportService } from "./src/ImportService";
import { ImportModal } from "./src/ImportModal";
import { generateBibtex } from "./src/BibtexGenerator";
import { bibtexFields, bibtexFromBody, PROP, TYPES } from "./src/schema";

export default class ResearchImporterPlugin extends Plugin {
  settings!: PluginSettings;
  private index!: VaultIndex;
  private creator!: NoteCreator;
  private importer!: ImportService;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Build in-memory vault index
    this.index = new VaultIndex(this.app);
    // Wait for metadata cache to be ready before indexing
    this.app.workspace.onLayoutReady(() => {
      this.index.build();
    });

    // Keep index in sync on file events
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        this.index.indexFile(file);
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) this.index.removeFile(file);
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile) {
          this.index.renameFile(oldPath, file);
        }
      })
    );

    this.creator = new NoteCreator(this.app, this.settings, this.index);
    this.importer = new ImportService(
      this.app,
      this.settings,
      this.index,
      this.creator
    );

    // ---- Commands ----------------------------------------------------------

    this.addCommand({
      id: "import-paper",
      name: "Import paper from DOI or arXiv ID",
      callback: () => {
        new ImportModal(this.app, (input) => {
          this.importer.run(input).catch((err) => {
            new Notice(`❌ Import failed: ${err.message}`, 8000);
            console.error("[ResearchImporter]", err);
          });
        }).open();
      },
    });

    this.addCommand({
      id: "regenerate-bibtex",
      name: "Re-generate BibTeX for all articles and books",
      callback: () => this.regenerateAllBibtex(),
    });

    this.addCommand({
      id: "refresh-active-note",
      name: "Refresh metadata for active note (check if preprint is published)",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) {
          this.importer.refreshActiveNote(file).catch((err) => {
            new Notice(`❌ Refresh failed: ${err.message}`, 8000);
            console.error("[ResearchImporter]", err);
          });
        }
        return true;
      },
    });

    // ---- Settings tab ------------------------------------------------------
    this.addSettingTab(new ResearchImporterSettingTab(this.app, this));

    // ---- Ribbon icon -------------------------------------------------------
    this.addRibbonIcon("book-open", "Import paper", () => {
      new ImportModal(this.app, (input) => {
        this.importer.run(input).catch((err) => {
          new Notice(`❌ Import failed: ${err.message}`, 8000);
          console.error("[ResearchImporter]", err);
        });
      }).open();
    });
  }

  onunload(): void {}

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // --------------------------------------------------------------------------
  // Re-generate all BibTeX
  // --------------------------------------------------------------------------

  private async regenerateAllBibtex(): Promise<void> {
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => {
        const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
        return fm?.[PROP.type] === TYPES.article || fm?.[PROP.type] === TYPES.book;
      });

    if (files.length === 0) {
      new Notice("No Article or Book notes found.", 4000);
      return;
    }

    new Notice(`Re-generating BibTeX for ${files.length} notes…`, 3000);
    let updated = 0;

    for (const file of files) {
      try {
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
        if (!fm) continue;

        // Fields the frontmatter does not carry (volume, pages, …) come from the
        // existing entry, so regenerating never loses them.
        const existing = bibtexFromBody(await this.app.vault.cachedRead(file));
        const old = bibtexFields(existing);
        const metadata = {
          inputType: "doi" as const,
          doi: fm[PROP.doi] ?? old.doi,
          arxivId: fm[PROP.arxiv] != null ? String(fm[PROP.arxiv]) : old.eprint,
          title: fm[PROP.title] ?? file.basename,
          year: Number(fm[PROP.year]) || 0,
          authors: authorsFromLinks(fm[PROP.authors], this.app, file.path),
          journalFull: undefined,
          journalShort: undefined,
          volume: old.volume,
          issue: old.number,
          pages: old.pages,
          publisher: old.publisher,
          isbn: fm[PROP.isbn] ?? old.isbn,
          itemType: (fm[PROP.type] === TYPES.book ? "book" : "article") as "article" | "book",
        };

        // Journal abbreviation from the journal note linked in the frontmatter
        const journalAbbrev = resolveJournalAbbrev(fm[PROP.journal], this.app) ?? old.journal;

        // When only some authors are linked (large collaborations), keep the full list.
        const oldAuthors = old.author ? old.author.split(/\s+and\s+/).length : 0;
        const authorField = oldAuthors > metadata.authors.length ? old.author : undefined;
        const newBibtex = generateBibtex({ metadata, journalAbbrev, authorField });

        // No provenance: nothing was re-fetched, so the source line stays as it is.
        await this.creator.writeBibtex(file, newBibtex, null);
        updated++;
      } catch (err) {
        console.warn(`[ResearchImporter] Could not regenerate bibtex for ${file.path}:`, err);
      }
    }

    new Notice(`✅ Updated BibTeX in ${updated} notes.`, 5000);
  }
}

// ---------------------------------------------------------------------------
// Helpers used by regenerateAllBibtex
// ---------------------------------------------------------------------------

/**
 * Authors from the frontmatter links, reading given and family names from each
 * Person note (so "Carlos Sánchez Muñoz" keeps a two-word family name). Falls
 * back to splitting the link text when the note or its name fields are missing.
 */
function authorsFromLinks(
  authors: unknown,
  app: App,
  sourcePath: string
): { given: string; family: string }[] {
  if (!Array.isArray(authors)) return [];
  return authors.map((a) => {
    const name = String(a).replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
    const person = app.metadataCache.getFirstLinkpathDest(name, sourcePath);
    const fm = person ? app.metadataCache.getFileCache(person)?.frontmatter : undefined;
    const given = fm?.[PROP.firstName];
    const family = fm?.[PROP.lastName];
    if (typeof family === "string" && family.trim()) {
      return { given: typeof given === "string" ? given : "", family };
    }
    const parts = name.split(/\s+/);
    return { given: parts.slice(0, -1).join(" "), family: parts[parts.length - 1] };
  });
}

function resolveJournalAbbrev(
  journalFm: string | undefined,
  app: App
): string | undefined {
  if (!journalFm) return undefined;
  // Strip wikilink: "[[Physical Review Letters]]" → "Physical Review Letters"
  const linkName = journalFm.replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
  if (!linkName) return undefined;

  // Try to find the journal note and get its first alias
  const journalFile = app.metadataCache.getFirstLinkpathDest(linkName, "");
  if (!journalFile) return linkName;

  const fm = app.metadataCache.getFileCache(journalFile)?.frontmatter;
  if (fm?.[PROP.abbreviation]) return String(fm[PROP.abbreviation]);
  return linkName;
}
