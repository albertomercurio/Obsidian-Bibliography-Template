// ---------------------------------------------------------------------------
// Reference check against the source
//
// Re-fetches the record of an article (Crossref for a DOI, arXiv otherwise) and
// compares it with the note: title, authors, journal, year, DOI and the content
// of the BibTeX entry (not its layout: braces, spacing, LaTeX accents and field
// order do not count). Differences are of two kinds:
//
//   missing    the note is silent and the source knows: `complete` adds it, and
//              is safe to run on the whole vault. It creates no notes, and adds
//              nothing when title, journal, year or DOI disagree: the record may
//              not be this work, or may be a later version of it.
//   conflicts  the note and the source disagree, and either can be wrong:
//              `restore` makes the note say what the source says, to be decided
//              one note at a time.
//
// Both keep the citation key, the user's notes, Read, Topics, PDF and the cover.
// Authors already linked stay linked when the source writes their name another
// way (initials, part of a compound surname).
// ---------------------------------------------------------------------------

import type { Frontmatter, NoteRef, VaultPort } from "./ports";
import type { PaperMetadata, PluginSettings } from "./types";
import { generateBibtex } from "./BibtexGenerator";
import type { ImportService } from "./ImportService";
import { sameFamilyName, sameGivenNames } from "./nameUtils";
import type { NoteCreator } from "./NoteCreator";
import type { VaultIndex } from "./VaultIndex";
import { bibtexFields, citekeyOf, PROP } from "./schema";

export interface CheckResult {
  file: NoteRef;
  missing: string[];
  conflicts: string[];
  /** Everything found: conflicts, then what is missing. */
  issues: string[];
  /** People and journals `restore` would create. */
  creates: string[];
  /** Adds only what is missing; absent when nothing is, or when the record may be another work. */
  complete?: () => Promise<void>;
  /** Makes the note say what the source says; absent when they agree. */
  restore?: () => Promise<void>;
}

const SIGNATURE_FIELDS = ["title", "journal", "year", "volume", "number", "pages", "doi", "eprint"];

/** Content of a value without layout: accents, LaTeX commands, braces, case and punctuation. */
export function normalized(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\\[A-Za-z]+/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Family names of a BibTeX author field, normalised. */
export function bibtexFamilies(authorField: string | undefined): string[] {
  if (!authorField) return [];
  return authorField
    .split(/\s+and\s+/)
    .map((name) => name.trim().replace(/^\{|\}$/g, ""))
    .map((name) => (name.includes(",") ? name.split(",")[0] : name.split(/\s+/).pop() ?? ""))
    .map(normalized)
    .filter(Boolean);
}

/** The same family names in the same order; a source may keep only the last part of one ("Frisk Kockum", "Kockum"). */
export function sameFamilies(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((family, i) => Boolean(family && b[i]) && (family.endsWith(b[i]) || b[i].endsWith(family)));
}

/** The authors a note links, with their names as the person notes hold them (else as the link writes them). */
export function linkedAuthors(vault: VaultPort, fm: Frontmatter, sourcePath: string): { link: string; given: string; family: string }[] {
  const links: unknown[] = Array.isArray(fm[PROP.authors]) ? fm[PROP.authors] : [fm[PROP.authors]];
  return links.filter((link): link is string => typeof link === "string").map((link) => {
    const name = link.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
    const person = vault.resolveLink(name, sourcePath);
    const own = person ? vault.frontmatter(person.path) : undefined;
    const words = name.split(/\s+/);
    return { link, given: own?.[PROP.firstName] || words.slice(0, -1).join(" "), family: own?.[PROP.lastName] || words[words.length - 1] };
  });
}

/** Fields of the canonical entry that the current one lacks, and those whose content differs. */
export function signatureDiff(current: string | undefined, canonical: string): { missing: string[]; different: string[] } {
  const cur = bibtexFields(current);
  const can = bibtexFields(canonical);
  if (!current || Object.keys(cur).length === 0) {
    // Text that is not an entry is not missing: only a restore, one note at a time, replaces it.
    return !current?.trim() || citekeyOf(current) ? { missing: ["entry"], different: [] } : { missing: [], different: ["entry"] };
  }
  const missing = SIGNATURE_FIELDS.filter((f) => can[f] && !cur[f]);
  const different = SIGNATURE_FIELDS.filter((f) => can[f] && cur[f] && normalized(cur[f]) !== normalized(can[f]));
  if (can.author && !sameFamilies(bibtexFamilies(cur.author), bibtexFamilies(can.author))) different.unshift("author");
  return { missing, different };
}

/** The entry with new fields before its closing brace; the rest stays as written. */
export function withFields(entry: string, fields: Record<string, string>): string {
  const body = entry.trimEnd().replace(/,?\s*\}$/, "");
  return `${[body, ...Object.entries(fields).map(([key, value]) => `  ${key} = {${value}}`)].join(",\n")}\n}`;
}

function sameValue(current: unknown, wanted: unknown): boolean {
  if (Array.isArray(wanted)) {
    return Array.isArray(current) && current.map(String).join("\n") === wanted.map(String).join("\n");
  }
  return String(current ?? "") === String(wanted ?? "");
}

const isBlank = (value: unknown) => value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);

export class ReferenceCheck {
  constructor(
    private vault: VaultPort,
    private settings: PluginSettings,
    private index: VaultIndex,
    private creator: NoteCreator,
    private importer: ImportService
  ) {}

  async check(file: NoteRef): Promise<CheckResult> {
    const fm: Frontmatter = this.vault.frontmatter(file.path) ?? {};
    const unchecked = (issue: string): CheckResult => ({ file, missing: [], conflicts: [issue], issues: [issue], creates: [] });
    const doi = fm[PROP.doi] ? String(fm[PROP.doi]) : "";
    const arxiv = fm[PROP.arxiv] ? String(fm[PROP.arxiv]) : "";
    if (!doi && !arxiv) return unchecked("no DOI or arXiv id: cannot compare with the source");
    let metadata: PaperMetadata;
    try {
      metadata = await this.importer.fetch(doi || arxiv);
    } catch (err) {
      return unchecked(`source unreachable: ${err instanceof Error ? err.message : err}`);
    }
    if (arxiv) metadata.arxivId = arxiv;

    // Authors and journal as an import would link them today, keeping those already linked.
    const max = Math.max(0, this.settings.maxAuthors ?? 0);
    const linked = max > 0 && metadata.authors.length > max ? metadata.authors.slice(0, 1) : metadata.authors;
    const creates: string[] = [];
    const actions: (() => Promise<unknown>)[] = [];
    const remaining = linkedAuthors(this.vault, fm, file.path);
    const authors = linked.map((a) => {
      const same = remaining.findIndex((p) => sameFamilyName(p.family, a.family) && sameGivenNames(p.given, a.given));
      if (same !== -1) return remaining.splice(same, 1)[0].link;
      const match = this.index.findPerson(a.given, a.family, a.orcid);
      if (match.file && (match.kind === "exact" || match.match === "fullName")) return `[[${match.file.basename}]]`;
      const planned = this.creator.planCreatePerson({ given: a.given, family: a.family, orcid: a.orcid });
      creates.push(`person ${planned.basename}`);
      actions.push(planned.commit);
      return `[[${planned.basename}]]`;
    });

    let journal: string | null = null;
    let abbrev = metadata.journalShort;
    let addAbbreviation: { line: string; run: () => Promise<void> } | undefined;
    if (metadata.journalFull) {
      const found = this.index.findJournal(metadata.journalFull).file
        ?? (metadata.journalShort ? this.index.findJournal(metadata.journalShort).file : undefined);
      if (found) {
        journal = `[[${found.basename}]]`;
        const own = this.vault.frontmatter(found.path)?.[PROP.abbreviation];
        if (typeof own === "string" && own.trim()) abbrev = own;
        else if (abbrev) {
          const value = abbrev;
          addAbbreviation = {
            line: `add Abbreviation «${value}» to ${found.basename}`,
            run: () => this.vault.processFrontMatter(found.path, (j) => { j[PROP.abbreviation] = value; }),
          };
        }
      } else {
        const publisher = this.importer.resolvePublisher(metadata.publisher);
        const planned = this.creator.planCreateJournal({ fullName: metadata.journalFull, shortName: metadata.journalShort, publisherName: publisher?.displayName });
        journal = `[[${planned.basename}]]`;
        if (publisher?.actions.length) creates.push(`publisher ${publisher.displayName}`);
        creates.push(`journal ${planned.basename}`);
        actions.push(...(publisher?.actions ?? []), planned.commit);
      }
    }

    const wanted: Frontmatter = {
      [PROP.title]: metadata.title,
      [PROP.authors]: authors,
      [PROP.journal]: journal,
      [PROP.year]: metadata.year > 0 ? metadata.year : null,
    };
    if (metadata.doi) wanted[PROP.doi] = metadata.doi;

    const missing: string[] = [];
    const conflicts: string[] = [];
    const missingKeys: string[] = [];
    let sameWork = true;
    for (const [key, value] of Object.entries(wanted)) {
      if (value === null || sameValue(fm[key], value)) continue;
      // Linking authors and a journal can create notes: never without looking.
      if (isBlank(fm[key]) && key !== PROP.authors && key !== PROP.journal) {
        missing.push(`add ${key} ${JSON.stringify(value)}`);
        missingKeys.push(key);
      } else {
        conflicts.push(`${key}: ${JSON.stringify(fm[key] ?? null)} → ${JSON.stringify(value)}`);
        if (key !== PROP.authors && !isBlank(fm[key])) sameWork = false;
      }
    }

    const current = typeof fm[PROP.bibtex] === "string" ? fm[PROP.bibtex] : undefined;
    const options = { metadata, journalAbbrev: abbrev, citeKey: citekeyOf(current), takenKeys: this.index.citeKeys };
    const canonical = generateBibtex(options);
    const diff = signatureDiff(current, canonical);
    // The same authors, written another way by the source: the entry keeps its own form.
    const ownAuthors = bibtexFields(current).author;
    const bibtex = ownAuthors && !diff.different.includes("author") ? generateBibtex({ ...options, authorField: ownAuthors }) : canonical;
    if (diff.missing.length) missing.push(`add to BibTeX: ${diff.missing.join(", ")}`);
    if (diff.different.length) conflicts.push(`BibTeX differs from the source: ${diff.different.join(", ")}`);
    if (addAbbreviation) missing.push(addAbbreviation.line);

    const result: CheckResult = { file, missing, conflicts, issues: [...conflicts, ...missing], creates: [] };
    if (!result.issues.length) return result;
    result.creates = creates;

    result.restore = async () => {
      for (const action of actions) await action();
      await addAbbreviation?.run();
      await this.vault.processFrontMatter(file.path, (target) => {
        for (const [key, value] of Object.entries(wanted)) if (value !== null) target[key] = value;
        target[PROP.bibtex] = bibtex;
        if (metadata.doi) delete target[PROP.url]; // the DOI resolves
      });
      this.index.indexFile(file);
    };

    if (missing.length && sameWork) {
      result.complete = async () => {
        await addAbbreviation?.run();
        const source = bibtexFields(canonical);
        await this.vault.processFrontMatter(file.path, (target) => {
          for (const key of missingKeys) target[key] = wanted[key];
          if (diff.missing.includes("entry")) target[PROP.bibtex] = bibtex;
          else if (diff.missing.length) target[PROP.bibtex] = withFields(target[PROP.bibtex], Object.fromEntries(diff.missing.map((f) => [f, source[f]])));
        });
        this.index.indexFile(file);
      };
    }
    return result;
  }
}
