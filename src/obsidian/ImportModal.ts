import { App, Modal, Setting } from "obsidian";

/** What to import: a DOI or arXiv id, a PDF of the paper, or both. */
export interface ImportRequest {
  id: string;
  /** The main PDF, a path in the vault: `<citation key>.pdf` when the note has none. */
  pdf?: string;
  /** More PDFs of the paper (supplementary material, other versions): `<citation key>-2.pdf`, `-3.pdf`… */
  more: string[];
  /** The cover: Figure 1 of the PDF, the image in the clipboard, or none. */
  cover: CoverSource;
  /** The reference the window was opened for, when its DOI or arXiv id was kept: no import. */
  note?: string;
}

export type CoverSource = "figure" | "clipboard" | "none";

export interface ImportChoices {
  /** PDFs the modal offers: those no note links. */
  pdfs: string[];
  /** The PDF chosen when the modal opens. */
  pdf?: string;
  /** The settings name a cover property. */
  covers: boolean;
  /** A reference of the vault: its DOI or arXiv id, and its name for the title. */
  reference?: { id: string; name: string; path: string };
}

export class ImportModal extends Modal {
  private request: ImportRequest;

  constructor(app: App, private choices: ImportChoices, private onSubmit: (request: ImportRequest) => void) {
    super(app);
    this.request = { id: choices.reference?.id ?? "", pdf: choices.pdf, more: [], cover: choices.covers ? "figure" : "none" };
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("research-importer-modal");
    const reference = this.choices.reference;
    contentEl.createEl("h2", { text: reference ? `Add files to ${reference.name}` : "Import paper" });

    contentEl.createEl("p", {
      text: reference
        ? "Choose its PDF, its supplementary material, or a cover. PDFs dragged into the vault are listed until a note links them."
        : "Paste a DOI (e.g. 10.1103/PhysRevLett.130.033605) or an arXiv ID (e.g. 2301.12345). With a PDF, it can stay empty: the plugin reads it in the PDF.",
      cls: "research-importer-hint",
    });

    new Setting(contentEl).setName("DOI or arXiv ID").addText((text) => {
      text.setValue(this.request.id).setPlaceholder(this.request.pdf ? "read in the PDF" : "10.xxxx/… or 2301.xxxxx").onChange((v) => (this.request.id = v.trim()));
      text.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          this.submit();
        }
      });
      setTimeout(() => text.inputEl.focus(), 50);
    });

    new Setting(contentEl)
      .setName("PDF")
      .setDesc("Optional: the main PDF, moved to the PDF folder of the settings, named after the citation key, and linked. A copy of a PDF the note links goes to the trash.")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "None");
        for (const path of this.choices.pdfs) dropdown.addOption(path, path);
        dropdown.setValue(this.request.pdf ?? "").onChange((value) => (this.request.pdf = value || undefined));
      });

    if (this.choices.pdfs.length) {
      new Setting(contentEl)
        .setName("More PDFs")
        .setDesc("Supplementary material, other versions: after the main PDF, as <citation key>-2.pdf, -3.pdf…")
        .setHeading();
      const list = contentEl.createDiv({ cls: "research-importer-more-pdfs" });
      list.style.maxHeight = "12em";
      list.style.overflowY = "auto";
      for (const path of this.choices.pdfs) {
        new Setting(list).setName(path).addToggle((toggle) =>
          toggle.setValue(false).onChange((on) => {
            this.request.more = on ? [...this.request.more, path] : this.request.more.filter((p) => p !== path);
          })
        );
      }
    }

    if (this.choices.covers) {
      new Setting(contentEl)
        .setName("Cover")
        .setDesc("Figure 1 cut from the PDF, or the image in the clipboard, such as a screenshot. Linked from the cover property of the settings.")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("figure", "Figure 1 of the PDF")
            .addOption("clipboard", "Image in the clipboard")
            .addOption("none", "None")
            .setValue(this.request.cover)
            .onChange((value) => (this.request.cover = value as CoverSource))
        );
    }

    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText("Import").setCta().onClick(() => this.submit()))
      .addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()));
  }

  private submit(): void {
    if (!this.request.id && !this.request.pdf && !this.request.more.length) return;
    this.close();
    // Figure 1 needs a PDF: the one chosen, or the one a reference links already.
    const cover = !this.choices.covers || (this.request.cover === "figure" && !this.request.pdf && !this.choices.reference) ? "none" : this.request.cover;
    const note = this.choices.reference && this.request.id === this.choices.reference.id ? this.choices.reference.path : undefined;
    // The main PDF once, first; ticked in the list too, it counts once.
    const more = this.request.more.filter((path) => path !== this.request.pdf);
    this.onSubmit({ ...this.request, more, cover, note });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
