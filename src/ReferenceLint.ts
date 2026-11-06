// ---------------------------------------------------------------------------
// Offline check of the references: each note against its own BibTeX entry, and
// the references against each other. No network and nothing written, so it can
// run on the whole vault after every import or edit by hand. Comparing a note
// with its source (Crossref, arXiv) is the job of ReferenceCheck.
//
// Every problem has a stable code, for reports, tests and agents:
//   bibtex-invalid      error    the BibTeX property is not an entry
//   bibtex-mismatch     error    its DOI differs from the DOI property (warning for the year)
//   bibtex-missing      info     no BibTeX: the note is left out of exports
//   bibtex-in-body      warning  a ```bibtex block in the body instead of the property
//   reference-mismatch  warning  title, arXiv id, authors or journal differ from the entry
//   article-duplicate   error    two references with the same DOI, arXiv id or citation key
//                                (warning: the same title, and no link between the notes)
// ---------------------------------------------------------------------------

import { allReferences, linksIn } from "./BibliographyExport";
import type { Frontmatter, NoteRef, VaultPort } from "./ports";
import { bibtexFamilies, linkedAuthors, normalized, sameFamilies } from "./ReferenceCheck";
import { bibtexFields, citekeyOf, PROP, splitNote } from "./schema";
import type { PluginSettings } from "./types";
import { normDoi } from "./VaultIndex";

export type Severity = "error" | "warning" | "info";

export interface Issue {
  severity: Severity;
  code: string;
  path: string;
  line: number;
  message: string;
  hint: string;
}

export interface LintResult {
  /** References checked: the articles and books of the vault. */
  checked: number;
  issues: Issue[];
}

interface Reference {
  note: NoteRef;
  fm: Frontmatter;
  text: string;
}

type Add = (severity: Severity, code: string, ref: Reference, line: number, message: string, hint?: string) => void;

const SEVERITY_ORDER: Severity[] = ["error", "warning", "info"];
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export async function lintReferences(vault: VaultPort, settings: Pick<PluginSettings, "templatesFolder" | "maxAuthors">): Promise<LintResult> {
  const references: Reference[] = [];
  for (const note of allReferences(vault, settings.templatesFolder).sort((a, b) => compare(a.path, b.path))) {
    references.push({ note, fm: vault.frontmatter(note.path) ?? {}, text: await vault.read(note.path) });
  }
  const issues: Issue[] = [];
  const add: Add = (severity, code, ref, line, message, hint = "") => issues.push({ severity, code, path: ref.note.path, line, message, hint });

  for (const ref of references) {
    checkBibtex(ref, add);
    checkReference(ref, vault, settings.maxAuthors, add);
  }
  checkDuplicates(references, vault, add);

  issues.sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      compare(a.path, b.path) ||
      a.line - b.line ||
      compare(a.code, b.code)
  );
  return { checked: references.length, issues };
}

export function countBySeverity(issues: Issue[]): Record<Severity, number> {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.severity]++;
  return counts;
}

/** One line per problem, then the counts; notices only with `all`. */
export function lintReport({ checked, issues }: LintResult, all: boolean): string {
  const counts = countBySeverity(issues);
  const lines = issues
    .filter((issue) => all || issue.severity !== "info")
    .map((issue) => `${issue.severity.padEnd(7)} ${issue.code.padEnd(18)} ${issue.path}:${issue.line}  ${issue.message}${issue.hint ? ` → ${issue.hint}` : ""}`);
  const more = !all && counts.info ? " (all: list the notices too)" : "";
  const summary = `${checked} references: ${counts.error} errors, ${counts.warning} warnings, ${counts.info} notices${more}`;
  return [...lines, ...(lines.length ? [""] : []), summary].join("\n");
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

const bibtexOf = (fm: Frontmatter): string | null => {
  const entry = fm[PROP.bibtex];
  return typeof entry === "string" && entry.trim() ? entry.trim() : null;
};

/** Line of a property in the note, so the report points at it; 1 when absent. */
function lineOf(text: string, key: string): number {
  const { yaml } = splitNote(text);
  if (yaml === null) return 1;
  const index = yaml.split(/\r?\n/).findIndex((line) => line.startsWith(`${key}:`));
  return index < 0 ? 1 : index + 2;
}

const isBlank = (value: unknown) => value === null || value === undefined || String(value).trim() === "";
const compareHint = (ref: Reference) => `compare it with the source: Check the active reference, or research-importer:check file="${ref.note.basename}"`;

function checkBibtex(ref: Reference, add: Add): void {
  const { body } = splitNote(ref.text);
  const bodyLine = ref.text.slice(0, ref.text.length - body.length).split("\n").length;
  const fence = body.split("\n").findIndex((line) => /^```bibtex[ \t]*\r?$/.test(line));
  if (fence >= 0) add("warning", "bibtex-in-body", ref, bodyLine + fence, "BibTeX in the body: it belongs in the BibTeX property", "move the entry into the property");

  const entry = bibtexOf(ref.fm);
  const line = lineOf(ref.text, PROP.bibtex);
  if (!entry) {
    add("info", "bibtex-missing", ref, line, "no BibTeX: left out of exports", `add it from the source: research-importer:check file="${ref.note.basename}" repair`);
    return;
  }
  if (!citekeyOf(entry)) {
    add("error", "bibtex-invalid", ref, line, "BibTeX entry header not recognised", compareHint(ref));
    return;
  }
  const fields = bibtexFields(entry);
  const doi = ref.fm[PROP.doi];
  if (!isBlank(doi) && fields.doi && normDoi(String(doi)) !== normDoi(fields.doi)) {
    add("error", "bibtex-mismatch", ref, lineOf(ref.text, PROP.doi), `DOI in the BibTeX (${fields.doi}) differs from the property (${doi})`, compareHint(ref));
  }
  const year = ref.fm[PROP.year];
  if (!isBlank(year) && fields.year && String(year) !== fields.year) {
    add("warning", "bibtex-mismatch", ref, lineOf(ref.text, PROP.year), `year in the BibTeX (${fields.year}) differs from the property (${year})`, compareHint(ref));
  }
}

/** The target of the first wikilink of a property. */
function linkOf(value: unknown): string | null {
  const first = Array.isArray(value) ? value.find((item) => typeof item === "string") : value;
  return typeof first === "string" ? (linksIn(first)[0] ?? null) : null;
}

function aliasesOf(fm: Frontmatter): string[] {
  const value = fm[PROP.aliases] ?? fm.aliases;
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((item) => item !== null && item !== "").map(String) : [];
}

/** Properties that disagree with the note's own BibTeX: title, arXiv id, authors, journal. */
function checkReference(ref: Reference, vault: VaultPort, maxAuthors: number, add: Add): void {
  const entry = bibtexOf(ref.fm);
  if (!entry || !citekeyOf(entry)) return;
  const fields = bibtexFields(entry);
  const report = (key: string, message: string) => add("warning", "reference-mismatch", ref, lineOf(ref.text, key), message, compareHint(ref));

  const title = ref.fm[PROP.title];
  if (!isBlank(title) && fields.title && normalized(title) !== normalized(fields.title)) {
    report(PROP.title, "Title differs from the title in the BibTeX");
  }
  const arxiv = ref.fm[PROP.arxiv];
  // An id written without quotes reads as a number: 2207.09470 becomes 2207.0947.
  const sameArxiv = typeof arxiv === "number" ? arxiv === Number(fields.eprint) : String(arxiv).trim() === fields.eprint;
  if (!isBlank(arxiv) && fields.eprint && !sameArxiv) report(PROP.arxiv, `arXiv ${arxiv} differs from eprint ${fields.eprint} in the BibTeX`);

  if (fields.author) {
    const families = bibtexFamilies(fields.author);
    // Over the limit of the settings, an import links only the first author.
    const expected = maxAuthors > 0 && families.length > maxAuthors ? families.slice(0, 1) : families;
    const linked = linkedAuthors(vault, ref.fm, ref.note.path).map(({ family }) => normalized(family));
    if (!sameFamilies(linked, expected)) {
      report(PROP.authors, `Authors (${linked.length}) do not match the authors in the BibTeX (${expected.length} expected)`);
    }
  }

  const journalName = linkOf(ref.fm[PROP.journal]);
  const journal = journalName ? vault.resolveLink(journalName, ref.note.path) : null;
  if (journal && fields.journal) {
    const own = vault.frontmatter(journal.path) ?? {};
    const names = [journal.basename, own[PROP.abbreviation], ...aliasesOf(own)].map(normalized);
    if (!names.includes(normalized(fields.journal))) report(PROP.journal, `journal in the BibTeX (${fields.journal}) differs from [[${journal.basename}]]`);
  }
}

/** The same work twice: by DOI, arXiv id or citation key across all references, by title within a type. */
function checkDuplicates(references: Reference[], vault: VaultPort, add: Add): void {
  const identities: [string, string, (ref: Reference) => unknown, (value: unknown) => string][] = [
    ["DOI", PROP.doi, (ref) => ref.fm[PROP.doi], (value) => normDoi(String(value))],
    ["arXiv", PROP.arxiv, (ref) => ref.fm[PROP.arxiv], (value) => String(value).trim().toLowerCase()],
    ["citation key", PROP.bibtex, (ref) => citekeyOf(ref.fm[PROP.bibtex]), (value) => String(value).toLowerCase()],
  ];
  for (const [label, key, get, norm] of identities) {
    const seen = new Map<string, string>();
    for (const ref of references) {
      const value = get(ref);
      if (isBlank(value)) continue;
      const id = norm(value);
      const first = seen.get(id);
      if (first) add("error", "article-duplicate", ref, lineOf(ref.text, key), `${label} ${value} is also in ${first}`, "keep one note: merge the two and delete the other");
      else seen.set(id, ref.note.path);
    }
  }

  const byTitle = new Map<string, Reference[]>();
  for (const ref of references) {
    const title = normalized(ref.fm[PROP.title]);
    if (!title) continue;
    const key = `${ref.fm[PROP.type]}\n${title}`;
    byTitle.set(key, [...(byTitle.get(key) ?? []), ref]);
  }
  for (const group of byTitle.values()) {
    if (group.length < 2) continue;
    // A property linking a note to another of the group (Version Of, Related…) says they are distinct on purpose.
    const links = new Map(group.map((ref) => [ref.note.path, new Set(linksIn(JSON.stringify(ref.fm)).map((link) => vault.resolveLink(link, ref.note.path)?.path))]));
    const linked = (a: string, b: string) => links.get(a)!.has(b) || links.get(b)!.has(a);
    for (const ref of group.slice(1)) {
      if (!group.some((other) => other !== ref && linked(ref.note.path, other.note.path))) {
        add("warning", "article-duplicate", ref, lineOf(ref.text, PROP.title), `same title as ${group[0].note.path}`, "if one is a version of the other (preprint, published article), link them in a property");
      }
    }
  }
}
