// The questions of an import, answered without asking, for the command line:
// the answers a careful default gives, kept so the output can show them.

import type { DisambiguationData, DisambiguationResult, Ui } from "./ports";

export class AutoUi implements Ui {
  readonly decisions: string[] = [];

  /** `apply` false: a preview, so nothing has been imported yet. */
  constructor(private log: (line: string) => void, private apply = true) {}

  notice(message: string): void {
    const text = this.apply ? message : message.replace(/^✅ Imported:/, "Would import:");
    this.log(text.replace(/\n/g, " "));
  }

  async confirmOverflow(total: number, max: number, visible: number): Promise<boolean> {
    this.decisions.push(`${total} authors (over ${max}): linked only the first${visible > 1 ? ` and the next ones up to ${visible}` : ""}, full list in the BibTeX`);
    return true;
  }

  async disambiguate(data: DisambiguationData): Promise<DisambiguationResult> {
    if (data.match === "fullName") {
      this.decisions.push(`${data.incoming.label}: same name as [[${data.candidate.label}]], using the existing note`);
      return { choice: "same" };
    }
    this.decisions.push(`${data.incoming.label}: may be the same person as "${data.candidate.label}", creating a new note`);
    return { choice: "different" };
  }

  open(): void {}
}
