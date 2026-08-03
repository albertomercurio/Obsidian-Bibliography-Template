import { App, TFile } from "obsidian";
import type { PersonMatchResult, JournalMatchResult } from "./types";
import { initialOf, normName } from "./nameUtils";
import { normOrcid } from "./AuthorMerge";

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

function normJournal(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.\-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// VaultIndex
// ---------------------------------------------------------------------------

// Keys under which a single file is stored across all forward indices.
interface FileKeys {
  orcid?: string;
  fullName?: string;
  initKey?: string;
  doi?: string;
  arxiv?: string;
  journalKeys?: string[];
}

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

  /**
   * Reverse map: file.path → all keys under which this file is stored.
   * Used for O(1) removal; also exposes the file's ORCID for findPerson.
   */
  private fileKeysIndex = new Map<string, FileKeys>();

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
    this.fileKeysIndex.clear();

    for (const file of this.app.vault.getMarkdownFiles()) {
      this.indexFile(file);
    }
  }

  /** Call this when a file is created/modified. Safe to call repeatedly. */
  indexFile(file: TFile): void {
    // Remove any stale keys from a previous version of this file first,
    // so a frontmatter edit (e.g. adding an ORCID) is always reflected correctly.
    this.removeFile(file);

    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache?.frontmatter) return;
    const fm = cache.frontmatter;
    const type: string = fm["type"] ?? "";
    const keys: FileKeys = {};

    if (type === "Person") {
      const given: string = fm["first_name"] ?? "";
      const family: string = fm["last_name"] ?? "";
      const orcid: string | undefined = fm["ORCiD"] ?? undefined;

      if (orcid) {
        keys.orcid = normOrcid(orcid);
        this.orcidIndex.set(keys.orcid, file);
      }

      if (given && family) {
        keys.fullName = normName(`${given} ${family}`);
        this.fullNameIndex.set(keys.fullName, file);

        keys.initKey = `${initialOf(given)} ${normName(family)}`;
        const arr = this.initialIndex.get(keys.initKey) ?? [];
        arr.push(file);
        this.initialIndex.set(keys.initKey, arr);
      }
    }

    if (type === "Article" || type === "Book") {
      const doi: string | undefined = fm["doi"];
      const arxiv: string | undefined = fm["arxiv_id"];
      if (doi) {
        keys.doi = normDoi(doi);
        this.doiIndex.set(keys.doi, file);
      }
      if (arxiv) {
        keys.arxiv = arxiv.trim();
        this.arxivIndex.set(keys.arxiv, file);
      }
    }

    if (type === "Journal") {
      const fullName: string = fm["full_name"] ?? file.basename;
      keys.journalKeys = [normJournal(fullName)];
      this.journalIndex.set(keys.journalKeys[0], file);

      const aliases: unknown = fm["aliases"];
      const aliasList: string[] = Array.isArray(aliases)
        ? aliases.map(String)
        : typeof aliases === "string"
        ? [aliases]
        : [];
      for (const alias of aliasList) {
        const k = normJournal(alias);
        keys.journalKeys.push(k);
        this.journalIndex.set(k, file);
      }
    }

    this.fileKeysIndex.set(file.path, keys);
  }

  /** Remove a file from all indices. O(1) via the reverse fileKeysIndex. */
  removeFile(file: TFile): void {
    const keys = this.fileKeysIndex.get(file.path);
    if (!keys) return;

    if (keys.orcid) this.orcidIndex.delete(keys.orcid);
    if (keys.fullName) this.fullNameIndex.delete(keys.fullName);
    if (keys.initKey) {
      const arr = (this.initialIndex.get(keys.initKey) ?? []).filter((f) => f !== file);
      if (arr.length) this.initialIndex.set(keys.initKey, arr);
      else this.initialIndex.delete(keys.initKey);
    }
    if (keys.doi) this.doiIndex.delete(keys.doi);
    if (keys.arxiv) this.arxivIndex.delete(keys.arxiv);
    for (const k of keys.journalKeys ?? []) this.journalIndex.delete(k);

    this.fileKeysIndex.delete(file.path);
  }

  /**
   * Update the reverse index after a file rename. O(1).
   * Forward indices (orcidIndex, fullNameIndex, etc.) hold TFile references which
   * Obsidian mutates in place on rename, so they stay valid automatically.
   */
  renameFile(oldPath: string, file: TFile): void {
    const keys = this.fileKeysIndex.get(oldPath);
    if (!keys) return;
    this.fileKeysIndex.delete(oldPath);
    this.fileKeysIndex.set(file.path, keys);
  }

  // --------------------------------------------------------------------------
  // Person lookup
  // --------------------------------------------------------------------------

  /**
   * True when both sides carry an ORCID and they differ — confirmed different
   * people, so the candidate must not be offered as a match.
   */
  private orcidRulesOut(candidate: TFile, incomingOrcid: string): boolean {
    if (!incomingOrcid) return false;
    const candidateOrcid = this.fileKeysIndex.get(candidate.path)?.orcid;
    return Boolean(candidateOrcid) && candidateOrcid !== incomingOrcid;
  }

  findPerson(
    given: string,
    family: string,
    orcid?: string
  ): PersonMatchResult {
    const incomingOrcid = orcid ? normOrcid(orcid) : "";

    // 1. ORCID exact match (most reliable)
    if (incomingOrcid) {
      const file = this.orcidIndex.get(incomingOrcid);
      if (file) return { kind: "exact", file, reason: "ORCID match" };
    }

    // 2. Full name match — only safe to trust without dialog when ORCID confirms identity.
    const fullKey = normName(`${given} ${family}`);
    const byFull = this.fullNameIndex.get(fullKey);
    if (byFull && !this.orcidRulesOut(byFull, incomingOrcid)) {
      // At least one ORCID is unknown; can't auto-confirm identity.
      return { kind: "partial", file: byFull, reason: "full name match – ORCID unconfirmed" };
    }

    // 3. Abbreviated given name on either side → compare initial + family.
    //    e.g. incoming "A. Mercurio", vault has "Alberto Mercurio" (or the reverse).
    const initKey = `${initialOf(given)} ${normName(family)}`;
    // Candidates whose ORCID confirms they are somebody else are not candidates.
    const byInitial = (this.initialIndex.get(initKey) ?? []).filter(
      (f) => !this.orcidRulesOut(f, incomingOrcid)
    );
    if (byInitial.length === 1) {
      return {
        kind: "partial",
        file: byInitial[0],
        reason: `abbreviated first name matches "${byInitial[0].basename}"`,
      };
    }
    if (byInitial.length > 1) {
      // Multiple candidates — return the first as a hint, disambiguate in UI
      return {
        kind: "partial",
        file: byInitial[0],
        reason: `${byInitial.length} candidates with initial "${initialOf(given)} ${family}"`,
      };
    }

    // The reverse case — incoming "Alberto Mercurio" against a vault "A. Mercurio" —
    // needs no extra tier: the vault file is indexed under initKey "a mercurio",
    // which step 3 looks up from the incoming initial.

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
