import { Notice, Plugin, TFile, type CliData, type CliFlags } from "obsidian";
import { DEFAULT_SETTINGS, ResearchImporterSettingTab } from "./src/obsidian/settings";
import type { PluginSettings } from "./src/types";
import { VaultIndex } from "./src/VaultIndex";
import { NoteCreator } from "./src/NoteCreator";
import { ImportService } from "./src/ImportService";
import { ReferenceCheck, type CheckResult } from "./src/ReferenceCheck";
import { lintReferences } from "./src/ReferenceLint";
import { addCommand, checkCommand, type CommandHost, coverCommand, exportCommand, lintCommand, type NoteQuery } from "./src/CommandLine";
import { addFiles, linkedFiles, makeCover, saveCover } from "./src/Attachments";
import { ImportModal, type ImportRequest } from "./src/obsidian/ImportModal";
import { identifierOf } from "./src/PdfFiles";
import { StagedVault } from "./src/StagedVault";
import { ConfirmModal } from "./src/obsidian/ConfirmModal";
import { LintModal } from "./src/obsidian/LintModal";
import { clipboardImage, obsidianHttp, ObsidianPdf, ObsidianUi, ObsidianVault, obsidianYaml, ref } from "./src/obsidian/ObsidianHost";
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

    const importPaper = (pdf?: string) =>
      new ImportModal(this.app, { pdfs: this.unlinkedPdfs(pdf), pdf, covers: Boolean(this.settings.coverProperty.trim()) }, (request) => {
        this.importPaper(request).catch((err) => this.fail("Import", err));
      }).open();

    this.addCommand({ id: "import-paper", name: "Import paper from DOI or arXiv ID", callback: () => importPaper() });
    this.addRibbonIcon("book-open", "Import paper", () => importPaper());

    this.addCommand({
      id: "import-active-pdf",
      name: "Import paper from the active PDF",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file?.extension.toLowerCase() !== "pdf") return false;
        if (!checking) importPaper(file.path);
        return true;
      },
    });

    this.addCommand({
      id: "make-cover",
      name: "Make a cover from Figure 1 of the active reference's PDF",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !this.canCover(file)) return false;
        if (!checking) this.makeCover(file).catch((err) => this.fail("Cover", err));
        return true;
      },
    });

    this.addCommand({
      id: "paste-cover",
      name: "Paste the cover of the active reference from the clipboard",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !this.isReference(file) || !this.settings.coverProperty.trim()) return false;
        if (!checking) this.pasteCover(file).catch((err) => this.fail("Cover", err));
        return true;
      },
    });

    // Right click on a PDF, or on a reference.
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile)) return;
        if (file.extension.toLowerCase() === "pdf") {
          menu.addItem((item) => item.setTitle("Import paper from this PDF").setIcon("book-open").onClick(() => importPaper(file.path)));
          return;
        }
        if (this.canCover(file)) {
          menu.addItem((item) =>
            item.setTitle("Make a cover from Figure 1").setIcon("image").onClick(() => this.makeCover(file).catch((err) => this.fail("Cover", err)))
          );
        }
        if (this.isReference(file) && this.settings.coverProperty.trim()) {
          menu.addItem((item) =>
            item.setTitle("Paste the cover from the clipboard").setIcon("clipboard-paste").onClick(() => this.pasteCover(file).catch((err) => this.fail("Cover", err)))
          );
        }
      })
    );

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
      id: "lint-references",
      name: "Check all references offline: BibTeX and duplicates",
      callback: () => {
        this.lintAllReferences().catch((err) => this.fail("Check", err));
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
    this.registerCli();
  }

  /** Commands of Obsidian's command line: `obsidian-cli research-importer:<name> key=value`. */
  private registerCli(): void {
    if (typeof this.registerCliHandler !== "function") return; // Obsidian before 1.12.2
    // A command may start Obsidian: wait for the metadata, as the palette's index does.
    const ready = () => new Promise<void>((resolve) => this.app.workspace.onLayoutReady(resolve));
    const cli = (name: string, description: string, flags: CliFlags | null, handler: (params: CliData) => Promise<string>) =>
      this.registerCliHandler(`research-importer:${name}`, description, flags, async (params) => {
        try {
          await ready();
          return await handler(params);
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : err}`;
        }
      });
    const host = (): CommandHost => ({ vault: this.vaultPort, http: obsidianHttp, settings: this.settings, yaml: obsidianYaml, pdf: new ObsidianPdf(this.app) });
    const on = (params: CliData, name: string) => params[name] === "true";
    const value = (params: CliData, name: string): string | undefined => {
      if (params[name] === "true") throw new Error(`${name} needs a value: ${name}=…`);
      return params[name]?.trim() || undefined;
    };
    const note = (params: CliData): NoteQuery => ({ file: value(params, "file"), path: value(params, "path") });

    cli(
      "add",
      "Import a paper from its DOI or arXiv id, or from its PDF, with its authors and journal; preview unless apply",
      {
        id: { value: "<DOI|arXiv>", description: "DOI or arXiv id of the paper (default: the one printed in the PDF)" },
        pdf: { value: "<path>", description: "A PDF of the paper in the vault: moved to the PDF folder, named after the citation key, and linked; a copy of the PDF a note links already goes to the trash" },
        cover: { description: "Also make a cover from Figure 1 of the PDF (needs the cover property in the settings)" },
        arxiv: { value: "<id>", description: "arXiv id of its preprint, when id is the DOI of the published version" },
        topics: { value: "<names>", description: "Topic notes to link, separated by commas" },
        same: { value: "<names>", description: "Authors that are the person already in the vault, named as the preview names them, separated by commas" },
        ask: { description: "Ask about uncertain authors in Obsidian's windows, as the palette does; with apply, it imports as the palette does" },
        apply: { description: "Write the notes" },
      },
      async (params) => {
        const list = (name: string) => value(params, name)?.split(",").map((item) => item.trim()).filter(Boolean);
        return addCommand(host(), {
          id: value(params, "id"),
          pdf: value(params, "pdf"),
          cover: on(params, "cover"),
          topics: list("topics"),
          arxiv: value(params, "arxiv"),
          same: list("same"),
          ask: on(params, "ask") ? new ObsidianUi(this.app) : undefined,
          apply: on(params, "apply"),
        });
      }
    );
    cli(
      "cover",
      "Make covers from Figure 1 of the PDF, for references without one; preview unless apply",
      {
        file: { value: "<name>", description: "Only this reference, by name (default: every reference with a PDF and no cover)" },
        path: { value: "<path>", description: "Only the reference at this path" },
        apply: { description: "Write the covers" },
      },
      async (params) => coverCommand(host(), { note: note(params), apply: on(params, "apply") })
    );
    cli(
      "check",
      "Compare references with their source (Crossref, arXiv); writes only with repair or restore, and apply",
      {
        file: { value: "<name>", description: "Only this reference, by name (default: all of them)" },
        path: { value: "<path>", description: "Only the reference at this path" },
        repair: { description: "Add what notes are missing, where the record is surely the same work; creates no notes" },
        restore: { description: "Make the named note say what the source says, which can be wrong too" },
        apply: { description: "Write the changes" },
      },
      async (params) =>
        checkCommand(host(), { note: note(params), repair: on(params, "repair"), restore: on(params, "restore"), apply: on(params, "apply") })
    );
    cli(
      "export",
      "Print the BibTeX of all references, or of those linked to a note; writes nothing",
      {
        file: { value: "<name>", description: "Only the references linked to this note: cited by it, or naming it as author, topic or journal" },
        path: { value: "<path>", description: "The same, naming the note by its path" },
      },
      async (params) => exportCommand(host(), { note: note(params) })
    );
    cli(
      "lint",
      "Check references without the network: each against its own BibTeX, and duplicates; writes nothing",
      {
        all: { description: "Also list the notices" },
        format: { value: "text|json", description: "Output format (default: text)" },
      },
      async (params) => lintCommand(host(), { all: on(params, "all"), json: value(params, "format") === "json" })
    );
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** PDFs that no note links, the given one first. */
  private unlinkedPdfs(first?: string): string[] {
    const linked = new Set<string>();
    for (const targets of Object.values(this.app.metadataCache.resolvedLinks)) for (const path of Object.keys(targets)) linked.add(path);
    const pdfs = this.app.vault
      .getFiles()
      .filter((file) => file.extension.toLowerCase() === "pdf" && !linked.has(file.path) && file.path !== first)
      .map((file) => file.path)
      .sort((a, b) => a.localeCompare(b));
    return first ? [first, ...pdfs] : pdfs;
  }

  /** The import of the palette, then the PDF and its cover. */
  private async importPaper(request: ImportRequest): Promise<void> {
    const pdf = new ObsidianPdf(this.app);
    // The clipboard first, before anything else can change it.
    const image = request.cover === "clipboard" ? await clipboardImage() : null;
    if (request.cover === "clipboard" && !image) new Notice("No image in the clipboard: no cover.", 6000);
    let id = request.id;
    if (!id && request.pdf) {
      new Notice("Reading the PDF…", 3000);
      id = identifierOf(await pdf.pages(request.pdf, 2));
    }
    const file = await this.importer.run(id);
    const note = file ?? this.importer.existing;
    if (!note || (!request.pdf && !image)) return;
    // The new note's properties reach the metadata cache a moment after it is written.
    const created = this.app.vault.getAbstractFileByPath(note.path);
    for (let i = 0; i < 60 && created instanceof TFile && !this.app.metadataCache.getFileCache(created)?.frontmatter?.[PROP.bibtex]; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const lines: string[] = [];
    const vault = new StagedVault(this.vaultPort, obsidianYaml, true);
    const result = request.pdf
      ? await addFiles(vault, pdf, this.settings, { note, created: Boolean(file), pdf: request.pdf, cover: request.cover === "figure" }, (line) => lines.push(line))
      : { moves: [] };
    if (image) lines.push(`Cover: ${await saveCover(vault, this.settings, note, image, (line) => lines.push(line))}, from the clipboard`);
    const shown = [...result.moves, ...lines].map((line) => line.replace(/^\s*[·+?-]\s+/, "").replace(/\s+\(move\)$/, ""));
    if (shown.length) new Notice(shown.join("\n"), 10000);
  }

  private isReference(file: TFile): boolean {
    const type = this.app.metadataCache.getFileCache(file)?.frontmatter?.[PROP.type];
    return type === TYPES.article || type === TYPES.book;
  }

  /** The image in the clipboard becomes the cover; replacing one asks first. */
  private async pasteCover(file: TFile): Promise<void> {
    const image = await clipboardImage();
    if (!image) {
      new Notice("No image in the clipboard. Take a screenshot to the clipboard first.", 6000);
      return;
    }
    const current = this.app.metadataCache.getFileCache(file)?.frontmatter?.[this.settings.coverProperty.trim()];
    if (current && !(await new ConfirmModal(this.app, `Replace the cover of "${file.basename}"?`, [`Now: ${current}`], "Replace").ask())) return;
    const lines: string[] = [];
    const path = await saveCover(new StagedVault(this.vaultPort, obsidianYaml, true), this.settings, ref(file), image, (line) => lines.push(line));
    new Notice([`✅ Cover: ${path}`, ...lines.map((line) => line.replace(/^\s*[·-]\s+/, ""))].join("\n"), 6000);
  }

  /** A reference with a PDF and no cover, when the settings name a cover property. */
  private canCover(file: TFile): boolean {
    const property = this.settings.coverProperty.trim();
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!property || !fm || fm[property] || (fm[PROP.type] !== TYPES.article && fm[PROP.type] !== TYPES.book)) return false;
    return linkedFiles(new StagedVault(this.vaultPort, obsidianYaml, false), ref(file), PROP.pdf).length > 0;
  }

  private async makeCover(file: TFile): Promise<void> {
    const vault = new StagedVault(this.vaultPort, obsidianYaml, true);
    const [pdf] = linkedFiles(vault, ref(file), PROP.pdf);
    const lines: string[] = [];
    new Notice("Looking for Figure 1…", 3000);
    const made = await makeCover(vault, new ObsidianPdf(this.app), this.settings, ref(file), { now: pdf, final: pdf }, (line) => lines.push(line));
    new Notice(made ? `✅ Cover made from Figure 1 of ${pdf}.` : lines.map((line) => line.replace(/^\s*[·!]\s+/, "")).join("\n"), 8000);
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
    if (!result.restore) {
      new Notice(result.issues.join("\n"), 8000);
      return;
    }
    const lines = [...result.issues, ...result.creates.map((c) => `Will create ${c}`)];
    if (await new ConfirmModal(this.app, `Differences in "${file.basename}"`, lines, "Restore from source").ask()) {
      await result.restore();
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

  private async lintAllReferences(): Promise<void> {
    const result = await lintReferences(this.vaultPort, this.settings);
    if (!result.issues.length) {
      new Notice(`✅ ${result.checked} references: each agrees with its BibTeX, and none is a duplicate.`, 5000);
      return;
    }
    new LintModal(this.app, result).open();
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
    const incomplete = different.filter((result) => result.complete);
    const lines = incomplete.map((result) => `${result.file.basename}: ${result.missing.join("; ")}`);
    const review = different.filter((result) => result.conflicts.length).map((result) => `${result.file.basename}: ${result.conflicts.join("; ")}`);
    const modal = new ConfirmModal(this.app, `${different.length} references differ from their sources`, lines, incomplete.length ? "Add what is missing" : null, review);
    if (await modal.ask()) {
      for (const result of incomplete) await result.complete!();
      new Notice(`✅ Completed ${incomplete.length} references from their sources.`, 5000);
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
