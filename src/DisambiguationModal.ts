import { App, Modal, Setting } from "obsidian";
import {
  isDestructive,
  mergedFields,
  valueOf,
  type MergeField,
} from "./AuthorMerge";

export type DisambiguationChoice =
  | "same"
  | "different"
  | "merge"
  | "skip"
  | "abort";

export interface DisambiguationResult {
  choice: DisambiguationChoice;
  /** The merge plan as the user left it. Only meaningful for choice "merge". */
  mergeFields?: MergeField[];
}

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
   * Per-field merge plan. When present the modal shows a "Merge" button and a
   * preview of the resulting record, with a dropdown per differing field so
   * the user can override the default choice. Only meaningful for authors.
   */
  mergePlan?: MergeField[];
  /** Current filename of the vault note, to warn about an impending rename. */
  candidateBasename?: string;
}

/**
 * Generic modal asking the user whether an incoming entity (author / journal)
 * from the API is the same as a candidate already in the vault.
 */
export class DisambiguationModal extends Modal {
  private choice: DisambiguationChoice = "abort";
  private resolve!: (r: DisambiguationResult) => void;
  /** Working copy of the plan — dropdowns mutate this, never the caller's array. */
  private plan: MergeField[];
  private resultEl?: HTMLElement;
  private renameEl?: HTMLElement;
  private mergeButtonEl?: HTMLElement;

  constructor(
    app: App,
    private data: DisambiguationData
  ) {
    super(app);
    this.plan = (data.mergePlan ?? []).map((f) => ({ ...f }));
  }

  /** Opens the modal and returns a promise that resolves when the user picks. */
  ask(): Promise<DisambiguationResult> {
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

    contentEl.createEl("p", {
      text: "Close this dialog to cancel the import.",
      cls: "research-importer-hint",
    });

    // Everything above the buttons scrolls, so the actions stay reachable
    // however tall the merge preview gets (matters on phones).
    const scroll = contentEl.createDiv({ cls: "ri-scroll" });

    // Two-column comparison
    const grid = scroll.createDiv({ cls: "research-importer-grid" });

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

    if (this.plan.length > 0) this.renderMergePreview(scroll);

    new Setting(contentEl)
      .setClass("ri-actions")
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

    if (this.plan.length > 0) {
      const mergeSetting = new Setting(contentEl).setClass("ri-actions");
      mergeSetting.setDesc(
        "Applies the selection above to the vault entry, keeping everything else in the note untouched."
      );
      mergeSetting.addButton((btn) => {
        btn.setButtonText("Merge — update vault entry").onClick(() => this.pick("merge"));
        this.mergeButtonEl = btn.buttonEl;
      });
    }

    this.refreshPreview();
  }

  // --------------------------------------------------------------------------
  // Merge preview
  // --------------------------------------------------------------------------

  private renderMergePreview(parent: HTMLElement): void {
    const box = parent.createDiv({ cls: "ri-merge" });
    box.createEl("h3", { text: "After merge" });

    for (const field of this.plan) {
      if (field.identical) {
        new Setting(box)
          .setClass("ri-merge-field")
          .setName(field.label)
          .setDesc(valueOf(field) || "—");
        continue;
      }

      const setting = new Setting(box)
        .setClass("ri-merge-field")
        .setName(field.label);
      if (field.conflicting) {
        setting.setDesc(
          "These look like different values — keeping the vault's unless you change it."
        );
        setting.settingEl.addClass("ri-conflict");
      }
      setting.addDropdown((dd) => {
        dd.addOption("vault", `${field.vault || "(empty)"} — in vault`);
        dd.addOption("incoming", `${field.incoming || "(empty)"} — from paper`);
        dd.setValue(field.chosen);
        dd.onChange((value) => {
          field.chosen = value === "incoming" ? "incoming" : "vault";
          this.refreshPreview();
        });
      });
    }

    this.resultEl = box.createEl("p", { cls: "ri-merge-result" });
    this.renameEl = box.createEl("p", { cls: "ri-detail" });
  }

  /** Recomputes the result line and the destructive styling of the merge button. */
  private refreshPreview(): void {
    if (this.plan.length === 0) return;

    const merged = mergedFields(this.plan);
    const name = `${merged.given} ${merged.family}`.trim();
    if (this.resultEl) {
      this.resultEl.setText(
        merged.orcid ? `${name} · ORCID ${merged.orcid}` : name || "(no name)"
      );
    }

    if (this.renameEl) {
      const current = this.data.candidateBasename;
      this.renameEl.setText(
        !current || name === current
          ? "Filename unchanged."
          : `File will be renamed to "${name}" — existing links update automatically.`
      );
    }

    // Only warn when the merge would actually replace something.
    this.mergeButtonEl?.toggleClass("mod-warning", isDestructive(this.plan));
  }

  private pick(choice: DisambiguationChoice): void {
    this.choice = choice;
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    this.resolve({
      choice: this.choice,
      mergeFields: this.plan.length > 0 ? this.plan : undefined,
    });
  }
}
