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
  /** The bytes of any file, such as a PDF. */
  readBinary(path: string): Promise<ArrayBuffer>;
  /** Creates the file, or replaces what it holds. */
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  /** Moves a file to the trash the user chose in the host; false when the host cannot. */
  trash(path: string): Promise<boolean>;
}

// ---- PDFs ----------------------------------------------------------------------

/** A run of text on a PDF page, in PDF points from the top-left corner. */
export interface PdfText {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Not horizontal, like the arXiv stamp in the margin. */
  rotated?: boolean;
}

export interface PdfPage {
  width: number;
  height: number;
  items: PdfText[];
}

/** A rectangle on a page, in PDF points from the top-left corner. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Reading PDFs: Obsidian has pdf.js; Node, for the tests, does not. */
export interface PdfPort {
  /** The text of the first `count` pages. */
  pages(path: string, count: number): Promise<PdfPage[]>;
  /** A region of a page as a PNG about `width` pixels wide, without its white margins. */
  png(path: string, page: number, box: Box, width: number): Promise<ArrayBuffer>;
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
