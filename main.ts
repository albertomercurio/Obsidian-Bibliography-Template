import { Notice, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, ResearchImporterSettingTab } from "./src/obsidian/settings";
import type { PluginSettings } from "./src/types";
import { VaultIndex } from "./src/VaultIndex";
import { NoteCreator } from "./src/NoteCreator";
import { ImportService } from "./src/ImportService";
import { ReferenceCheck, type CheckResult } from "./src/ReferenceCheck";
import { ImportModal } from "./src/obsidian/ImportModal";
import { ConfirmModal } from "./src/obsidian/ConfirmModal";
import { obsidianHttp, ObsidianUi, ObsidianVault, ref } from "./src/obsidian/ObsidianHost";
import { generateBibtex } from "./src/BibtexGenerator";
import { allReferences, bibliography, referencesLinkedTo } from "./src/BibliographyExport";
import { bibtexFields, citekeyOf, PROP, TYPES } from "./src/schema";
import type { NoteRef, VaultPort } from "./src/ports";

export default class ResearchImporterPlugin extends Plugin {
  settings!: PluginSettings;
  private vaultPort!: ObsidianVault;
  private index!: VaultIndex;
  private creator!: NoteCreator;
  private importer!: ImportService;
  private checker!: ReferenceCheck;

  async onload(): Promise<void> {
    await this.loadSettings();
    const ui = new ObsidianUi(this.app);
    this.vaultPort = new ObsidianVault(this.app);
    this.index = new VaultIndex(this.vaultPort, this.settings.templatesFolder);
    this.creator = new NoteCreator(this.vaultPort, this.settings, ui, this.index);
    this.importer = new ImportService(this.vaultPort, ui, obsidianHttp, this.settings, this.index, this.creator);
    this.checker = new ReferenceCheck(this.vaultPort, this.settings, this.index, this.creator, this.importer);

    // Wait for the metadata cache before indexing.
    this.app.workspace.onLayoutReady(() => this.index.build());
    this.registerEvent(this.app.metadataCache.on("changed", (file) => this.index.indexFile(ref(file))));
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) this.index.removeFile(ref(file));
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile) this.index.renameFile(oldPath, ref(file));
      })
    );

    const importPaper = () =>
      new ImportModal(this.app, (input) => {
        this.importer.run(input).catch((err) => this.fail("Import", err));
      }).open();

    this.addCommand({ id: "import-paper", name: "Import paper from DOI or arXiv ID", callback: importPaper });
    this.addRibbonIcon("book-open", "Import paper", importPaper);

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
        if (!checking) this.importer.refreshActiveNote(ref(file)).catch((err) => this.fail("Refresh", err));
        return true;
      },
    });

    this.addCommand({
      id: "check-active-reference",
      name: "Check the active reference against its source",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const type = file ? this.app.metadataCache.getFileCache(file)?.frontmatter?.[PROP.type] : undefined;
        if (!file || (type !== TYPES.article && type !== TYPES.book)) return false;
        if (!checking) this.checkReference(file).catch((err) => this.fail("Check", err));
        return true;
      },
    });

    this.addCommand({
      id: "check-all-references",
      name: "Check all references against their sources",
      callback: () => {
        this.checkAllReferences().catch((err) => this.fail("Check", err));
      },
    });

    this.addCommand({
      id: "copy-all-bibtex",
      name: "Copy the BibTeX of all references",
      callback: () => {
        this.copyBibtex(this.references().map(ref)).catch((err) => this.fail("Export", err));
      },
    });

    this.addCommand({
      id: "copy-note-bibtex",
      name: "Copy the BibTeX of the references linked to the active note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) {
          referencesLinkedTo(this.vaultPort, ref(file), this.references().map(ref))
            .then((notes) => this.copyBibtex(notes))
            .catch((err) => this.fail("Export", err));
        }
        return true;
      },
    });

    this.addSettingTab(new ResearchImporterSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private fail(what: string, err: unknown): void {
    new Notice(`❌ ${what} failed: ${err instanceof Error ? err.message : err}`, 8000);
    console.error("[ResearchImporter]", err);
  }

  private async checkReference(file: TFile): Promise<void> {
    new Notice("Comparing with the source…", 3000);
    const result = await this.checker.check(ref(file));
    if (!result.issues.length) {
      new Notice(`✅ "${file.basename}" matches its source.`, 5000);
      return;
    }
    if (!result.repair) {
      new Notice(result.issues.join("\n"), 8000);
      return;
    }
    const lines = [...result.issues, ...result.creates.map((c) => `Will create ${c}`)];
    if (await new ConfirmModal(this.app, `Differences in "${file.basename}"`, lines, "Restore from source").ask()) {
      await result.repair();
      new Notice(`✅ Restored "${file.basename}" from its source.`, 5000);
    }
  }

  /** Articles and books of the vault, without the templates. */
  private references(): TFile[] {
    const paths = new Set(allReferences(this.vaultPort, this.settings.templatesFolder).map(({ path }) => path));
    return this.app.vault.getMarkdownFiles().filter((file) => paths.has(file.path));
  }

  private async copyBibtex(notes: NoteRef[]): Promise<void> {
    const { text, skipped } = bibliography(this.vaultPort, notes);
    for (const { path, reason } of skipped) console.warn(`[ResearchImporter] Left out ${path}: ${reason}`);
    if (!text) {
      new Notice("No BibTeX to copy.", 5000);
      return;
    }
    await navigator.clipboard.writeText(text);
    const leftOut = skipped.length ? `, ${skipped.length} left out` : "";
    new Notice(`✅ Copied ${notes.length - skipped.length} BibTeX entries${leftOut}.`, 5000);
  }

  private async checkAllReferences(): Promise<void> {
    const files = this.references();
    new Notice(`Comparing ${files.length} references with their sources…`, 5000);
    const results: CheckResult[] = [];
    for (const file of files) results.push(await this.checker.check(ref(file)));
    const different = results.filter((result) => result.issues.length);
    if (!different.length) {
      new Notice(`✅ ${files.length} references match their sources.`, 5000);
      return;
    }
    const lines = different.map((result) => `${result.file.basename}: ${result.issues.join("; ")}`);
    if (await new ConfirmModal(this.app, `Differences in ${different.length} references`, lines, "Restore from sources").ask()) {
      for (const result of different) await result.repair?.();
      new Notice(`✅ Restored ${different.length} references from their sources.`, 5000);
    }
  }

  // --------------------------------------------------------------------------
  // Re-generate all BibTeX
  // --------------------------------------------------------------------------

  private async regenerateAllBibtex(): Promise<void> {
    const files = this.references();
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
        const existing = typeof fm[PROP.bibtex] === "string" ? fm[PROP.bibtex] : undefined;
        const old = bibtexFields(existing);
        const metadata = {
          inputType: "doi" as const,
          doi: fm[PROP.doi] ?? old.doi,
          arxivId: fm[PROP.arxiv] != null ? String(fm[PROP.arxiv]) : old.eprint,
          title: fm[PROP.title] ?? file.basename,
          year: Number(fm[PROP.year]) || 0,
          authors: authorsFromLinks(fm[PROP.authors], this.vaultPort, file.path),
          volume: old.volume,
          issue: old.number,
          pages: old.pages,
          publisher: old.publisher,
          isbn: fm[PROP.isbn] ?? old.isbn,
          itemType: (fm[PROP.type] === TYPES.book ? "book" : "article") as "article" | "book",
        };
        const journalAbbrev = journalAbbreviation(fm[PROP.journal], this.vaultPort) ?? old.journal;
        // When only some authors are linked (large collaborations), keep the full list.
        const oldAuthors = old.author ? old.author.split(/\s+and\s+/).length : 0;
        const authorField = oldAuthors > metadata.authors.length ? old.author : undefined;
        const bibtex = generateBibtex({ metadata, journalAbbrev, authorField, citeKey: citekeyOf(existing) });
        await this.creator.writeBibtex(ref(file), bibtex);
        updated++;
      } catch (err) {
        console.warn(`[ResearchImporter] Could not regenerate BibTeX for ${file.path}:`, err);
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
function authorsFromLinks(authors: unknown, vault: VaultPort, sourcePath: string): { given: string; family: string }[] {
  if (!Array.isArray(authors)) return [];
  return authors.map((a) => {
    const name = String(a).replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
    const person = vault.resolveLink(name, sourcePath);
    const fm = person ? vault.frontmatter(person.path) : undefined;
    const given = fm?.[PROP.firstName];
    const family = fm?.[PROP.lastName];
    if (typeof family === "string" && family.trim()) {
      return { given: typeof given === "string" ? given : "", family };
    }
    const parts = name.split(/\s+/);
    return { given: parts.slice(0, -1).join(" "), family: parts[parts.length - 1] };
  });
}

/** The Abbreviation of the journal note a link points to, else the link text. */
function journalAbbreviation(journal: unknown, vault: VaultPort): string | undefined {
  if (typeof journal !== "string") return undefined;
  const name = journal.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
  if (!name) return undefined;
  const note = vault.resolveLink(name, "");
  const abbreviation = note ? vault.frontmatter(note.path)?.[PROP.abbreviation] : undefined;
  return typeof abbreviation === "string" && abbreviation.trim() ? abbreviation : name;
}
