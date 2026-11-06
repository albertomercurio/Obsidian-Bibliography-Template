// The questions of an import, for the command line: answered without asking,
// with the answers a careful default gives; or by the names given as `same`;
// or asked in the host's windows (`ask`). Every answer is kept, so the output
// can show it.

import { normName } from "./nameUtils";
import type { DisambiguationChoice, DisambiguationData, DisambiguationResult, Ui } from "./ports";

export interface AutoUiOptions {
  /** Authors that are the person already in the vault, named as the paper names them. */
  same?: string[];
  /** Asks the questions instead of answering them: the windows of the plugin. */
  ask?: Ui;
}

/** What an answer did, for the output. */
function answer(data: DisambiguationData, choice: DisambiguationChoice): string {
  const note = data.candidateBasename ?? data.candidate.label;
  if (data.match === "orcidSearch") return choice === "same" ? `ORCID of ${data.candidate.details ?? data.candidate.label}` : choice === "abort" ? "import canceled" : "no ORCID";
  return {
    same: `the same person as [[${note}]]`,
    merge: `merged into [[${note}]]`,
    different: "a different person: new note",
    skip: "left without a note",
    abort: "import canceled",
  }[choice];
}

export class AutoUi implements Ui {
  readonly decisions: string[] = [];
  private same: Map<string, string>;
  private used = new Set<string>();

  /** `apply` false: a preview, so nothing has been imported yet. */
  constructor(private log: (line: string) => void, private apply = true, private options: AutoUiOptions = {}) {
    this.same = new Map((options.same ?? []).map((name) => [normName(name), name.trim()]));
  }

  /** True when the questions go to the host's windows. */
  get asks(): boolean {
    return Boolean(this.options.ask);
  }

  /** Names given as `same` that no question was about. */
  get unusedSame(): string[] {
    return [...this.same].filter(([key]) => !this.used.has(key)).map(([, name]) => name);
  }

  notice(message: string): void {
    const text = this.apply ? message : message.replace(/^✅ Imported:/, "Would import:");
    this.log(text.replace(/\n/g, " "));
  }

  async confirmOverflow(total: number, max: number, visible: number): Promise<boolean> {
    const linked = `linked only the first${visible > 1 ? ` and the next ones up to ${visible}` : ""}, full list in the BibTeX`;
    if (this.options.ask) {
      const confirmed = await this.options.ask.confirmOverflow(total, max, visible);
      this.decisions.push(`${total} authors (over ${max}): ${confirmed ? linked : "import canceled"} (your answer)`);
      return confirmed;
    }
    this.decisions.push(`${total} authors (over ${max}): ${linked}`);
    return true;
  }

  async disambiguate(data: DisambiguationData): Promise<DisambiguationResult> {
    const incoming = data.incoming.label;
    if (this.options.ask) {
      const result = await this.options.ask.disambiguate(data);
      this.decisions.push(`${incoming}: ${answer(data, result.choice)} (your answer)`);
      return result;
    }
    const key = normName(incoming);
    if (this.same.has(key) && data.candidateBasename) {
      this.used.add(key);
      this.decisions.push(`${incoming}: ${answer(data, "same")} (same=)`);
      return { choice: "same" };
    }
    if (data.match === "fullName") {
      this.decisions.push(`${incoming}: same name as [[${data.candidate.label}]], using the existing note`);
      return { choice: "same" };
    }
    const details = data.candidate.details ? ` (${data.candidate.details})` : "";
    this.decisions.push(`${incoming}: may be the same person as "${data.candidate.label}"${details}, creating a new note; same="${incoming}" links the existing one`);
    return { choice: "different" };
  }

  open(): void {}
}
