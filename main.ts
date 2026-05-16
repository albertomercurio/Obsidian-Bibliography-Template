import { App, Notice, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, ResearchImporterSettingTab } from "./src/settings";
import type { PluginSettings } from "./src/types";
import { VaultIndex } from "./src/VaultIndex";
import { NoteCreator } from "./src/NoteCreator";
import { ImportService } from "./src/ImportService";
import { ImportModal } from "./src/ImportModal";
import { generateBibtex } from "./src/BibtexGenerator";

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
      this.app.vault.on("rename", (file) => {
        if (file instanceof TFile) {
          this.index.build(); // simplest correct approach on rename
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
        return fm?.type === "Article" || fm?.type === "Book";
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

        // Reconstruct minimal metadata needed for bibtex regeneration
        const metadata = {
          inputType: "doi" as const,
          doi: fm.doi,
          arxivId: fm.arxiv_id,
          title: fm.title ?? file.basename,
          year: Number(fm.year) || 0,
          authors: parseAuthorsFromFm(fm.authors),
          journalFull: undefined,
          journalShort: undefined,
          itemType: (fm.type === "Book" ? "book" : "article") as "article" | "book",
        };

        // Extract journal abbreviation from existing wikilink "[[Physical Review Letters]]"
        const journalRaw: string | undefined = fm.journal;
        const journalAbbrev = resolveJournalAbbrev(
          journalRaw,
          this.app
        );

        const newBibtex = generateBibtex({ metadata, journalAbbrev });

        await this.app.fileManager.processFrontMatter(file, (fmObj) => {
          fmObj["bibtex"] = newBibtex;
        });
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

function parseAuthorsFromFm(authors: unknown): { given: string; family: string }[] {
  if (!Array.isArray(authors)) return [];
  return authors.map((a) => {
    // Strip wikilink syntax "[[First Last]]"
    const name = String(a).replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
    const parts = name.split(/\s+/);
    const family = parts[parts.length - 1];
    const given = parts.slice(0, -1).join(" ");
    return { given, family };
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
  const aliases: unknown = fm?.["aliases"];
  if (Array.isArray(aliases) && aliases.length > 0) {
    return String(aliases[0]);
  }
  return fm?.["full_name"] ?? linkName;
}
