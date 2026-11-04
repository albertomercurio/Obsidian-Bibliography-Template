import { App, Modal, Setting } from "obsidian";

export class AuthorOverflowModal extends Modal {
  private confirmed = false;
  private resolve!: (confirmed: boolean) => void;

  constructor(
    app: App,
    private readonly authorCount: number,
    private readonly maxAuthors: number,
    private readonly visibleAuthors: number
  ) {
    super(app);
  }

  ask(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("research-importer-modal");
    contentEl.createEl("h2", { text: "Large author list detected" });

    contentEl.createEl("p", {
      text: `This paper has ${this.authorCount} authors, which exceeds your current maximum of ${this.maxAuthors}.`,
    });

    contentEl.createEl("p", {
      text: `If you continue, the plugin will keep the full author list in BibTeX but create only the first ${this.visibleAuthors} author${this.visibleAuthors === 1 ? "" : "s"} in your Obsidian metadata to avoid flooding the vault.`,
    });

    contentEl.createEl("p", {
      text: "Close this dialog or click Abort to cancel the import.",
      cls: "research-importer-hint",
    });

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Continue import")
          .setCta()
          .onClick(() => this.pick(true))
      )
      .addButton((btn) =>
        btn
          .setButtonText("Abort")
          .setWarning()
          .onClick(() => this.pick(false))
      );
  }

  private pick(confirmed: boolean): void {
    this.confirmed = confirmed;
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    this.resolve(this.confirmed);
  }
}