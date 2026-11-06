import { App, Modal, Setting, TFile } from "obsidian";
import { countBySeverity, type LintResult, type Severity } from "../ReferenceLint";

const SECTIONS: [Severity, string][] = [
  ["error", "Errors"],
  ["warning", "Warnings"],
  ["info", "Notices"],
];

/** The problems found by the offline check, grouped by severity; a click on a note opens it. */
export class LintModal extends Modal {
  constructor(app: App, private result: LintResult) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    const { checked, issues } = this.result;
    const counts = countBySeverity(issues);
    contentEl.addClass("research-importer-modal");
    contentEl.createEl("h2", { text: `${checked} references: ${counts.error} errors, ${counts.warning} warnings, ${counts.info} notices` });
    contentEl.createEl("p", {
      cls: "research-importer-hint",
      text: "Each reference against its own BibTeX, and the references against each other, without the network. Nothing was changed.",
    });
    for (const [severity, title] of SECTIONS) {
      const group = issues.filter((issue) => issue.severity === severity);
      if (!group.length) continue;
      contentEl.createEl("h3", { text: `${title} (${group.length})` });
      const list = contentEl.createEl("ul", { cls: "research-importer-issues" });
      for (const issue of group) {
        const item = list.createEl("li");
        const link = item.createEl("a", { text: issue.path.split("/").pop()!.replace(/\.md$/, ""), href: "#" });
        link.addEventListener("click", (event) => {
          event.preventDefault();
          this.openNote(issue.path);
        });
        item.appendText(`: ${issue.message}`);
        if (issue.hint) item.createDiv({ cls: "research-importer-hint", text: issue.hint });
      }
    }
    new Setting(contentEl).addButton((button) => button.setButtonText("Close").onClick(() => this.close()));
  }

  private openNote(path: string): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    this.close();
    void this.app.workspace.getLeaf(false).openFile(file);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
