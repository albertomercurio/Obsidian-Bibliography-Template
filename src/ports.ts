// ---------------------------------------------------------------------------
// Ports: what the core needs from its host.
//
// The core (import, BibTeX, note creation, checks) runs in two hosts: the
// Obsidian plugin (desktop and mobile) and Node, for the tests and for checking
// a vault where Obsidian is not available. Neither "obsidian" nor
// Node modules are imported by the core; each host implements these interfaces
// (src/obsidian/, src/node/).
// ---------------------------------------------------------------------------

import type { MergeField } from "./AuthorMerge";

/** A note in the vault: path from the vault root, file name without ".md". */
export interface NoteRef {
  path: string;
  basename: string;
}

export type Frontmatter = Record<string, any>;

export interface HttpResponse {
  status: number;
  text: string;
  json: any;
}

export type Http = (request: { url: string; headers?: Record<string, string> }) => Promise<HttpResponse>;

export interface VaultPort {
  markdownFiles(): NoteRef[];
  frontmatter(path: string): Frontmatter | undefined;
  exists(path: string): boolean;
  read(path: string): Promise<string>;
  ensureFolder(path: string): Promise<void>;
  create(path: string, content: string): Promise<NoteRef>;
  processFrontMatter(path: string, fn: (fm: Frontmatter) => void): Promise<void>;
  process(path: string, fn: (text: string) => string): Promise<void>;
  /** Renames a note updating every link to it; null when the host cannot. */
  rename(path: string, newPath: string): Promise<NoteRef | null>;
  /** The note a wikilink points to, resolved as Obsidian does. */
  resolveLink(linkpath: string, sourcePath: string): NoteRef | null;
}

// ---- Questions the core may ask -----------------------------------------------

export type DisambiguationChoice = "same" | "different" | "merge" | "skip" | "abort";

export interface DisambiguationResult {
  choice: DisambiguationChoice;
  /** The merge plan as the user left it. Only meaningful for choice "merge". */
  mergeFields?: MergeField[];
}

export interface DisambiguationData {
  /** Short label for what is being compared, e.g. "author" or "journal" */
  entityType: string;
  /** Why the candidate matched: "fullName" (same full name), "initial" or "orcidSearch". */
  match?: "fullName" | "initial" | "orcidSearch";
  /** Data from the incoming paper (API) */
  incoming: { label: string; details?: string };
  /** Candidate already in the vault */
  candidate: { label: string; details?: string };
  /** Per-field merge plan; only meaningful for authors. */
  mergePlan?: MergeField[];
  /** Current filename of the vault note, to warn about an impending rename. */
  candidateBasename?: string;
}

export interface Ui {
  notice(message: string, timeout?: number): void;
  /** More authors than the limit: link only the first `visible` ones? */
  confirmOverflow(total: number, max: number, visible: number): Promise<boolean>;
  disambiguate(data: DisambiguationData): Promise<DisambiguationResult>;
  /** Shows a note to the user, when the host has a view. */
  open(basename: string): void;
}
