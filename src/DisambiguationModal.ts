import { App, Modal, Setting } from "obsidian";

export type DisambiguationChoice = "same" | "different" | "merge" | "skip";

export interface DisambiguationData {
  /** Short label for what is being compared, e.g. "author" or "journal" */
  entityType: string;
  /** Data from the incoming paper (API) */
  incoming: {
    label: string;
    details?: string;
  };
  /** Candidate already in the vault */
  candidate: {
    label: string;
    details?: string;
  };
  /**
   * When true, shows a "Merge" button that lets the user overwrite the
   * vault entry's name/ORCID with the richer incoming data and rename the
   * file.  Only meaningful for author disambiguation.
   */
  allowMerge?: boolean;
}

/**
 * Generic modal asking the user whether an incoming entity (author / journal)
 * from the API is the same as a candidate already in the vault.
 */
export class DisambiguationModal extends Modal {
  private choice: DisambiguationChoice = "skip";
  private resolve!: (c: DisambiguationChoice) => void;

  constructor(
    app: App,
    private data: DisambiguationData
  ) {
    super(app);
  }

  /** Opens the modal and returns a promise that resolves when the user picks. */
  ask(): Promise<DisambiguationChoice> {
    return new Promise((res) => {
      this.resolve = res;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl, data } = this;
    contentEl.addClass("research-importer-modal");
    contentEl.createEl("h2", {
      text: `Possible duplicate ${data.entityType}`,
    });

    contentEl.createEl("p", {
      text: `The imported paper references a ${data.entityType} that may already exist in your vault. Are these the same?`,
    });

    // Two-column comparison
    const grid = contentEl.createDiv({ cls: "research-importer-grid" });

    const left = grid.createDiv({ cls: "research-importer-col" });
    left.createEl("h3", { text: "From paper" });
    left.createEl("p", { text: data.incoming.label, cls: "ri-name" });
    if (data.incoming.details) {
      left.createEl("p", {
        text: data.incoming.details,
        cls: "ri-detail",
      });
    }

    const right = grid.createDiv({ cls: "research-importer-col" });
    right.createEl("h3", { text: "In your vault" });
    right.createEl("p", { text: data.candidate.label, cls: "ri-name" });
    if (data.candidate.details) {
      right.createEl("p", {
        text: data.candidate.details,
        cls: "ri-detail",
      });
    }

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Same — reuse vault entry")
          .setCta()
          .onClick(() => this.pick("same"))
      )
      .addButton((btn) =>
        btn
          .setButtonText("Different — create new")
          .onClick(() => this.pick("different"))
      )
      .addButton((btn) =>
        btn
          .setButtonText("Skip — unresolved link")
          .onClick(() => this.pick("skip"))
      );

    if (data.allowMerge) {
      const mergeSetting = new Setting(contentEl);
      mergeSetting.setDesc(
        "Overwrites the vault entry's name and ORCID with the incoming data, then renames the file. Obsidian updates all existing links automatically."
      );
      mergeSetting.addButton((btn) =>
        btn
          .setButtonText("Merge — update vault entry")
          .setWarning()
          .onClick(() => this.pick("merge"))
      );
    }
  }

  private pick(choice: DisambiguationChoice): void {
    this.choice = choice;
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    this.resolve(this.choice);
  }
}
