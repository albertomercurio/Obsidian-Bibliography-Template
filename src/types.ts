// Shared types for the Research Literature Manager plugin

export interface PluginSettings {
  articlesFolder: string;
  booksFolder: string;
  peopleFolder: string;
  journalsFolder: string;
  skipOrcidSearch: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  articlesFolder: "Articles",
  booksFolder: "Books",
  peopleFolder: "People",
  journalsFolder: "Journals",
  skipOrcidSearch: false,
};

// Normalised metadata returned by any fetch service
export interface PaperMetadata {
  inputType: "doi" | "arxiv";
  doi?: string;
  arxivId?: string;
  title: string;
  year: number;
  authors: AuthorRaw[];
  /** Full journal name as returned by the API */
  journalFull?: string;
  /** Short journal name / abbreviation from the API (may be absent) */
  journalShort?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  url?: string;
  /** For books */
  isbn?: string;
  itemType: "article" | "book" | "preprint";
  abstract?: string;
  /**
   * Title with math rendered as inline LaTeX ($...$). Used exclusively for
   * .bib output. Do NOT use for filenames or frontmatter — Obsidian won't
   * render LaTeX there.
   */
  titleLatex?: string;
}

export interface AuthorRaw {
  given: string;
  family: string;
  /** ORCID without URL prefix, e.g. "0000-0001-2345-6789" */
  orcid?: string;
}

// Result of a vault-index lookup
export type MatchKind = "exact" | "partial" | "none";

export interface PersonMatchResult {
  kind: MatchKind;
  /** The vault file, present when kind !== "none" */
  file?: import("obsidian").TFile;
  /** Human-readable reason, e.g. "full name match" */
  reason?: string;
}

export interface JournalMatchResult {
  kind: "exact" | "none";
  file?: import("obsidian").TFile;
}
