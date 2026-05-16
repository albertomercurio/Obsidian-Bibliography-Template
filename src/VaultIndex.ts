import { App, TFile } from "obsidian";
import type { PersonMatchResult, JournalMatchResult } from "./types";

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

function normName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .toLowerCase()
    .trim();
}

function normJournal(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.\-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Alberto" → "a"  |  "A." → "a" */
function initialOf(given: string): string {
  return given.replace(/\.$/, "").charAt(0).toLowerCase();
}

// ---------------------------------------------------------------------------
// VaultIndex
// ---------------------------------------------------------------------------

export class VaultIndex {
  private app: App;

  /** ORCID → file */
  private orcidIndex = new Map<string, TFile>();
  /** Normalised "given family" → file */
  private fullNameIndex = new Map<string, TFile>();
  /** Normalised "initial family" (e.g. "a mercurio") → file[] */
  private initialIndex = new Map<string, TFile[]>();

  /** doi (normalised) → file */
  doiIndex = new Map<string, TFile>();
  /** arxiv id → file */
  arxivIndex = new Map<string, TFile>();

  /** Normalised journal key (full name or alias) → file */
  private journalIndex = new Map<string, TFile>();

  constructor(app: App) {
    this.app = app;
  }

  build(): void {
    this.orcidIndex.clear();
    this.fullNameIndex.clear();
    this.initialIndex.clear();
    this.doiIndex.clear();
    this.arxivIndex.clear();
    this.journalIndex.clear();

    for (const file of this.app.vault.getMarkdownFiles()) {
      this.indexFile(file);
    }
  }

  /** Call this when a file is created/modified */
  indexFile(file: TFile): void {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache?.frontmatter) return;
    const fm = cache.frontmatter;
    const type: string = fm["type"] ?? "";

    if (type === "Person") {
      const given: string = fm["first_name"] ?? "";
      const family: string = fm["last_name"] ?? "";
      const orcid: string | undefined = fm["ORCiD"] ?? undefined;

      if (orcid) this.orcidIndex.set(orcid.trim(), file);

      if (given && family) {
        const fullKey = normName(`${given} ${family}`);
        this.fullNameIndex.set(fullKey, file);

        const initKey = `${initialOf(given)} ${normName(family)}`;
        const arr = this.initialIndex.get(initKey) ?? [];
        arr.push(file);
        this.initialIndex.set(initKey, arr);
      }
    }

    if (type === "Article" || type === "Book") {
      const doi: string | undefined = fm["doi"];
      const arxiv: string | undefined = fm["arxiv_id"];
      if (doi) this.doiIndex.set(normDoi(doi), file);
      if (arxiv) this.arxivIndex.set(arxiv.trim(), file);
    }

    if (type === "Journal") {
      const fullName: string = fm["full_name"] ?? file.basename;
      this.journalIndex.set(normJournal(fullName), file);

      // Index every alias
      const aliases: unknown = fm["aliases"];
      const aliasList: string[] = Array.isArray(aliases)
        ? aliases.map(String)
        : typeof aliases === "string"
        ? [aliases]
        : [];
      for (const alias of aliasList) {
        this.journalIndex.set(normJournal(alias), file);
      }
    }
  }

  /** Remove a file from all indices (used on delete/rename) */
  removeFile(file: TFile): void {
    for (const [k, v] of this.orcidIndex) if (v === file) this.orcidIndex.delete(k);
    for (const [k, v] of this.fullNameIndex) if (v === file) this.fullNameIndex.delete(k);
    for (const [k, arr] of this.initialIndex) {
      const filtered = arr.filter((f) => f !== file);
      if (filtered.length) this.initialIndex.set(k, filtered);
      else this.initialIndex.delete(k);
    }
    for (const [k, v] of this.doiIndex) if (v === file) this.doiIndex.delete(k);
    for (const [k, v] of this.arxivIndex) if (v === file) this.arxivIndex.delete(k);
    for (const [k, v] of this.journalIndex) if (v === file) this.journalIndex.delete(k);
  }

  // --------------------------------------------------------------------------
  // Person lookup
  // --------------------------------------------------------------------------

  findPerson(
    given: string,
    family: string,
    orcid?: string
  ): PersonMatchResult {
    // 1. ORCID exact match (most reliable)
    if (orcid) {
      const file = this.orcidIndex.get(orcid.trim());
      if (file) return { kind: "exact", file, reason: "ORCID match" };
    }

    // 2. Full name exact match
    const fullKey = normName(`${given} ${family}`);
    const byFull = this.fullNameIndex.get(fullKey);
    if (byFull) return { kind: "exact", file: byFull, reason: "full name match" };

    // 3. Abbreviated given name in incoming data → check against full names in vault
    //    e.g. incoming "A. Mercurio", vault has "Alberto Mercurio"
    const initKey = `${initialOf(given)} ${normName(family)}`;
    const byInitial = this.initialIndex.get(initKey);
    if (byInitial && byInitial.length === 1) {
      return {
        kind: "partial",
        file: byInitial[0],
        reason: `abbreviated first name matches "${byInitial[0].basename}"`,
      };
    }
    if (byInitial && byInitial.length > 1) {
      // Multiple candidates — return the first as a hint, disambiguate in UI
      return {
        kind: "partial",
        file: byInitial[0],
        reason: `${byInitial.length} candidates with initial "${initialOf(given)} ${family}"`,
      };
    }

    // 4. Incoming full name might match a vault abbreviated name:
    //    incoming "Alberto Mercurio", vault has "A. Mercurio"
    //    Re-check by looking up the initial of the incoming given name
    //    against the full name index.
    // (Already covered above; if vault file has "A." as first_name it won't
    //  appear in fullNameIndex as "alberto mercurio". We flag partial instead.)

    return { kind: "none" };
  }

  // --------------------------------------------------------------------------
  // Journal lookup
  // --------------------------------------------------------------------------

  findJournal(name: string): JournalMatchResult {
    const key = normJournal(name);
    const file = this.journalIndex.get(key);
    if (file) return { kind: "exact", file };
    return { kind: "none" };
  }
}

// ---------------------------------------------------------------------------
// DOI normalisation
// ---------------------------------------------------------------------------

export function normDoi(doi: string): string {
  return doi
    .replace(/^https?:\/\/doi\.org\//i, "")
    .replace(/^doi:/i, "")
    .toLowerCase()
    .trim();
}
