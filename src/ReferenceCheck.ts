// ---------------------------------------------------------------------------
// Reference check against the source
//
// Re-fetches the record of an article (Crossref for a DOI, arXiv otherwise) and
// compares it with the note: title, authors, journal, year, DOI and the content
// of the BibTeX entry (not its layout: braces, spacing, LaTeX accents and field
// order do not count). A repair restores them from the source, keeping the
// citation key, the user's notes, Read, Topics, PDF and the cover.
// ---------------------------------------------------------------------------

import type { Frontmatter, NoteRef, VaultPort } from "./ports";
import type { PaperMetadata, PluginSettings } from "./types";
import { generateBibtex } from "./BibtexGenerator";
import type { ImportService } from "./ImportService";
import type { NoteCreator } from "./NoteCreator";
import type { VaultIndex } from "./VaultIndex";
import { bibtexFields, citekeyOf, PROP } from "./schema";

export interface CheckResult {
  file: NoteRef;
  issues: string[];
  /** People and journals the repair would create. */
  creates: string[];
  /** Applies the repair; absent when there is nothing to repair. */
  repair?: () => Promise<void>;
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

/** Fields whose content differs between two entries; [] when they say the same. */
export function signatureDiff(current: string | undefined, canonical: string): string[] {
  const cur = bibtexFields(current);
  const can = bibtexFields(canonical);
  if (!current || Object.keys(cur).length === 0) return ["entry missing or unreadable"];
  const changed = SIGNATURE_FIELDS.filter((f) => can[f] && normalized(cur[f]) !== normalized(can[f]));
  if (can.author && bibtexFamilies(cur.author).join("|") !== bibtexFamilies(can.author).join("|")) {
    changed.unshift("author");
  }
  return changed;
}

function sameValue(current: unknown, wanted: unknown): boolean {
  if (Array.isArray(wanted)) {
    return Array.isArray(current) && current.map(String).join("\n") === wanted.map(String).join("\n");
  }
  return String(current ?? "") === String(wanted ?? "");
}

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
    const doi = fm[PROP.doi] ? String(fm[PROP.doi]) : "";
    const arxiv = fm[PROP.arxiv] ? String(fm[PROP.arxiv]) : "";
    if (!doi && !arxiv) {
      return { file, issues: ["no DOI or arXiv id: cannot compare with the source"], creates: [] };
    }
    let metadata: PaperMetadata;
    try {
      metadata = await this.importer.fetch(doi || arxiv);
    } catch (err) {
      return { file, issues: [`source unreachable: ${err instanceof Error ? err.message : err}`], creates: [] };
    }
    if (arxiv) metadata.arxivId = arxiv;

    // Authors and journal as an import would link them today.
    const max = Math.max(0, this.settings.maxAuthors ?? 0);
    const linked = max > 0 && metadata.authors.length > max ? metadata.authors.slice(0, 1) : metadata.authors;
    const creates: string[] = [];
    const actions: (() => Promise<unknown>)[] = [];
    const authors = linked.map((a) => {
      const match = this.index.findPerson(a.given, a.family, a.orcid);
      if (match.file && (match.kind === "exact" || match.match === "fullName")) return `[[${match.file.basename}]]`;
      const planned = this.creator.planCreatePerson({ given: a.given, family: a.family, orcid: a.orcid });
      creates.push(`person ${planned.basename}`);
      actions.push(planned.commit);
      return `[[${planned.basename}]]`;
    });
    let journal: string | null = null;
    let abbrev = metadata.journalShort;
    if (metadata.journalFull) {
      const found = this.index.findJournal(metadata.journalFull).file
        ?? (metadata.journalShort ? this.index.findJournal(metadata.journalShort).file : undefined);
      if (found) {
        journal = `[[${found.basename}]]`;
        const own = this.vault.frontmatter(found.path)?.[PROP.abbreviation];
        if (typeof own === "string" && own.trim()) abbrev = own;
        else if (abbrev) {
          creates.push(`Abbreviation «${abbrev}» for ${found.basename}`);
          const value = abbrev;
          actions.push(() => this.vault.processFrontMatter(found.path, (j) => { j[PROP.abbreviation] = value; }));
        }
      } else {
        const planned = this.creator.planCreateJournal({ fullName: metadata.journalFull, shortName: metadata.journalShort });
        journal = `[[${planned.basename}]]`;
        creates.push(`journal ${planned.basename}`);
        actions.push(planned.commit);
      }
    }

    const wanted: Frontmatter = {
      [PROP.title]: metadata.title,
      [PROP.authors]: authors,
      [PROP.journal]: journal,
      [PROP.year]: metadata.year > 0 ? metadata.year : null,
    };
    if (metadata.doi) wanted[PROP.doi] = metadata.doi;
    const issues: string[] = [];
    for (const [key, value] of Object.entries(wanted)) {
      if (value !== null && !sameValue(fm[key], value)) {
        issues.push(`${key}: ${JSON.stringify(fm[key] ?? null)} → ${JSON.stringify(value)}`);
      }
    }
    const bibtex = generateBibtex({
      metadata,
      journalAbbrev: abbrev,
      citeKey: citekeyOf(fm[PROP.bibtex]),
      takenKeys: this.index.citeKeys,
    });
    const changed = signatureDiff(typeof fm[PROP.bibtex] === "string" ? fm[PROP.bibtex] : undefined, bibtex);
    if (changed.length) issues.push(`BibTeX differs from the source: ${changed.join(", ")}`);
    if (creates.some((c) => c.startsWith("Abbreviation"))) issues.push(creates.find((c) => c.startsWith("Abbreviation"))!);
    if (!issues.length) return { file, issues, creates: [] };

    return {
      file,
      issues,
      creates,
      repair: async () => {
        for (const action of actions) await action();
        await this.vault.processFrontMatter(file.path, (target) => {
          for (const [key, value] of Object.entries(wanted)) if (value !== null) target[key] = value;
          target[PROP.bibtex] = bibtex;
          if (metadata.doi) delete target[PROP.url]; // the DOI resolves
        });
        this.index.indexFile(file);
      },
    };
  }
}
