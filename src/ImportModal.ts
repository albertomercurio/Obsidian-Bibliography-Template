import { App, Modal, Setting } from "obsidian";

export class ImportModal extends Modal {
  private value = "";
  private onSubmit: (input: string) => void;

  constructor(app: App, onSubmit: (input: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("research-importer-modal");
    contentEl.createEl("h2", { text: "Import paper" });

    contentEl.createEl("p", {
      text: "Paste a DOI (e.g. 10.1103/PhysRevLett.130.033605) or an arXiv ID (e.g. 2301.12345).",
      cls: "research-importer-hint",
    });

    new Setting(contentEl)
      .setName("DOI or arXiv ID")
      .addText((text) => {
        text
          .setPlaceholder("10.xxxx/… or 2301.xxxxx")
          .onChange((v) => (this.value = v.trim()));
        // Submit on Enter
        text.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            this.submit();
          }
        });
        // Auto-focus
        setTimeout(() => text.inputEl.focus(), 50);
      });

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Import")
          .setCta()
          .onClick(() => this.submit())
      )
      .addButton((btn) =>
        btn.setButtonText("Cancel").onClick(() => this.close())
      );
  }

  private submit(): void {
    if (!this.value) return;
    this.close();
    this.onSubmit(this.value);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
