import { App, Modal, Setting } from "obsidian";

/** Shows what a change would do and asks whether to apply it; `review` lists what it leaves alone. */
export class ConfirmModal extends Modal {
  private confirmed = false;
  private resolve!: (confirmed: boolean) => void;

  constructor(
    app: App,
    private title: string,
    private lines: string[],
    private action: string | null,
    private review: string[] = []
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
    if (this.review.length) {
      contentEl.createEl("h3", { text: "Not changed: decide one at a time" });
      contentEl.createEl("p", { text: "The note and the source disagree, and either can be wrong. Open the note and run Check the active reference." });
      const others = contentEl.createEl("ul");
      for (const line of this.review) others.createEl("li", { text: line });
    }
    const buttons = new Setting(contentEl);
    if (this.action) buttons.addButton((btn) => btn.setButtonText(this.action!).setCta().onClick(() => this.pick(true)));
    buttons.addButton((btn) => btn.setButtonText(this.action ? "Cancel" : "Close").onClick(() => this.pick(false)));
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
