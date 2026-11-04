import { App, Modal, Setting } from "obsidian";

/** Shows a list of findings and asks whether to apply a change. */
export class ConfirmModal extends Modal {
  private confirmed = false;
  private resolve!: (confirmed: boolean) => void;

  constructor(
    app: App,
    private title: string,
    private lines: string[],
    private action: string
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
    contentEl.createEl("h2", { text: this.title });
    const list = contentEl.createEl("ul");
    for (const line of this.lines) list.createEl("li", { text: line });
    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText(this.action).setCta().onClick(() => this.pick(true)))
      .addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.pick(false)));
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
