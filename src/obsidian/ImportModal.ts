import { App, Modal, Setting } from "obsidian";

/** What to import: a DOI or arXiv id, a PDF of the paper, or both. */
export interface ImportRequest {
  id: string;
  /** Path of a PDF in the vault: moved next to the others, named after the citation key, and linked. */
  pdf?: string;
  /** Cut a cover from Figure 1 of the PDF. */
  cover: boolean;
}

export interface ImportChoices {
  /** PDFs the modal offers: those no note links. */
  pdfs: string[];
  /** The PDF chosen when the modal opens. */
  pdf?: string;
  /** The settings name a cover property. */
  covers: boolean;
}

export class ImportModal extends Modal {
  private request: ImportRequest;

  constructor(app: App, private choices: ImportChoices, private onSubmit: (request: ImportRequest) => void) {
    super(app);
    this.request = { id: "", pdf: choices.pdf, cover: choices.covers };
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("research-importer-modal");
    contentEl.createEl("h2", { text: "Import paper" });

    contentEl.createEl("p", {
      text: "Paste a DOI (e.g. 10.1103/PhysRevLett.130.033605) or an arXiv ID (e.g. 2301.12345). With a PDF, it can stay empty: the plugin reads it in the PDF.",
      cls: "research-importer-hint",
    });

    new Setting(contentEl).setName("DOI or arXiv ID").addText((text) => {
      text.setPlaceholder(this.request.pdf ? "read in the PDF" : "10.xxxx/… or 2301.xxxxx").onChange((v) => (this.request.id = v.trim()));
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
      .setDesc("Optional: moved to the PDF folder of the settings, named after the citation key, and linked. A copy of the PDF the note links already goes to the trash.")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "None");
        for (const path of this.choices.pdfs) dropdown.addOption(path, path);
        dropdown.setValue(this.request.pdf ?? "").onChange((value) => (this.request.pdf = value || undefined));
      });

    if (this.choices.covers) {
      new Setting(contentEl)
        .setName("Cover from Figure 1")
        .setDesc("Cut from the PDF, linked from the cover property of the settings.")
        .addToggle((toggle) => toggle.setValue(this.request.cover).onChange((value) => (this.request.cover = value)));
    }

    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText("Import").setCta().onClick(() => this.submit()))
      .addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()));
  }

  private submit(): void {
    if (!this.request.id && !this.request.pdf) return;
    this.close();
    this.onSubmit({ ...this.request, cover: this.choices.covers && this.request.cover && Boolean(this.request.pdf) });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
