import type { NoteRef, VaultPort } from "./ports";
import type { PersonMatchResult, JournalMatchResult } from "./types";
import { initialOf, normName } from "./nameUtils";
import { normOrcid } from "./AuthorMerge";
import { citekeyOf, PROP, TYPES } from "./schema";

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
  citeKey?: string;
  journalKeys?: string[];
}

export class VaultIndex {

  /** ORCID → file */
  private orcidIndex = new Map<string, NoteRef>();
  /** Normalised "given family" → file */
  private fullNameIndex = new Map<string, NoteRef>();
  /** Normalised "initial family" (e.g. "a mercurio") → file[] */
  private initialIndex = new Map<string, NoteRef[]>();

  /** doi (normalised) → file */
  doiIndex = new Map<string, NoteRef>();
  /** arxiv id → file */
  arxivIndex = new Map<string, NoteRef>();
  /** Citation keys of the BibTeX entries in the vault. */
  citeKeys = new Set<string>();

  /** Normalised journal key (full name or alias) → file */
  private journalIndex = new Map<string, NoteRef>();

  /**
   * Reverse map: file.path → all keys under which this file is stored.
   * Used for O(1) removal; also exposes the file's ORCID for findPerson.
   */
  private fileKeysIndex = new Map<string, FileKeys>();

  /** Notes in `ignoredFolder` (the templates) are not real people, papers or journals. */
  constructor(private vault: VaultPort, private ignoredFolder = "") {}

  build(): void {
    this.orcidIndex.clear();
    this.fullNameIndex.clear();
    this.initialIndex.clear();
    this.doiIndex.clear();
    this.arxivIndex.clear();
    this.journalIndex.clear();
    this.fileKeysIndex.clear();

    for (const file of this.vault.markdownFiles()) {
      this.indexFile(file);
    }
  }

  /** Call this when a file is created/modified. Safe to call repeatedly. */
  indexFile(file: NoteRef): void {
    // Remove any stale keys from a previous version of this file first,
    // so a frontmatter edit (e.g. adding an ORCID) is always reflected correctly.
    this.removeFile(file);
    if (this.ignoredFolder && file.path.startsWith(`${this.ignoredFolder}/`)) return;

    const fm = this.vault.frontmatter(file.path);
    if (!fm) return;
    const type: string = fm[PROP.type] ?? "";
    const keys: FileKeys = {};

    if (type === TYPES.person) {
      const given: string = fm[PROP.firstName] ?? "";
      const family: string = fm[PROP.lastName] ?? "";
      const orcid: string | undefined = fm[PROP.orcid] ?? undefined;

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

    if (type === TYPES.article || type === TYPES.book) {
      const doi: string | undefined = fm[PROP.doi];
      const arxiv: string | undefined = fm[PROP.arxiv] != null ? String(fm[PROP.arxiv]) : undefined;
      if (doi) {
        keys.doi = normDoi(doi);
        this.doiIndex.set(keys.doi, file);
      }
      if (arxiv) {
        keys.arxiv = arxiv.trim();
        this.arxivIndex.set(keys.arxiv, file);
      }
      const citeKey = citekeyOf(fm[PROP.bibtex]);
      if (citeKey) {
        keys.citeKey = citeKey;
        this.citeKeys.add(citeKey);
      }
    }

    if (type === TYPES.journal) {
      keys.journalKeys = [normJournal(file.basename)];
      this.journalIndex.set(keys.journalKeys[0], file);
      const abbreviation: unknown = fm[PROP.abbreviation];
      if (typeof abbreviation === "string" && abbreviation.trim()) {
        keys.journalKeys.push(normJournal(abbreviation));
        this.journalIndex.set(normJournal(abbreviation), file);
      }

      const aliases: unknown = fm[PROP.aliases] ?? fm["aliases"];
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
  removeFile(file: NoteRef): void {
    const keys = this.fileKeysIndex.get(file.path);
    if (!keys) return;

    if (keys.orcid) this.orcidIndex.delete(keys.orcid);
    if (keys.fullName) this.fullNameIndex.delete(keys.fullName);
    if (keys.initKey) {
      const arr = (this.initialIndex.get(keys.initKey) ?? []).filter((f) => f.path !== file.path);
      if (arr.length) this.initialIndex.set(keys.initKey, arr);
      else this.initialIndex.delete(keys.initKey);
    }
    if (keys.doi) this.doiIndex.delete(keys.doi);
    if (keys.arxiv) this.arxivIndex.delete(keys.arxiv);
    if (keys.citeKey) this.citeKeys.delete(keys.citeKey);
    for (const k of keys.journalKeys ?? []) this.journalIndex.delete(k);

    this.fileKeysIndex.delete(file.path);
  }

  /** Re-indexes a renamed note under its new path. */
  renameFile(oldPath: string, file: NoteRef): void {
    this.removeFile({ path: oldPath, basename: file.basename });
    this.indexFile(file);
  }

  // --------------------------------------------------------------------------
  // Person lookup
  // --------------------------------------------------------------------------

  /**
   * True when both sides carry an ORCID and they differ — confirmed different
   * people, so the candidate must not be offered as a match.
   */
  private orcidRulesOut(candidate: NoteRef, incomingOrcid: string): boolean {
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
      return { kind: "partial", file: byFull, match: "fullName", reason: "full name match – ORCID unconfirmed" };
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
        match: "initial",
        reason: `abbreviated first name matches "${byInitial[0].basename}"`,
      };
    }
    if (byInitial.length > 1) {
      // Multiple candidates — return the first as a hint, disambiguate in UI
      return {
        kind: "partial",
        file: byInitial[0],
        match: "initial",
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
