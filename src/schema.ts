// ---------------------------------------------------------------------------
// Note layout: property names, default templates and body helpers.
// Pure module: unit-tested with Node.
// ---------------------------------------------------------------------------

export const TYPES = { article: "Article", book: "Book", person: "Person", journal: "Journal", publisher: "Publisher" } as const;

export const PROP = {
  type: "Type",
  title: "Title",
  authors: "Authors",
  journal: "Journal",
  year: "Year",
  doi: "DOI",
  arxiv: "arXiv",
  url: "URL",
  pdf: "PDF",
  read: "Read",
  isbn: "ISBN",
  publisher: "Publisher",
  topics: "Topics",
  bibtex: "BibTeX",
  firstName: "First Name",
  lastName: "Last Name",
  orcid: "ORCID",
  email: "Email",
  affiliations: "Affiliations",
  relationship: "Relationship",
  abbreviation: "Abbreviation",
  aliases: "Aliases",
} as const;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** The properties of a note, in order, and its body. */
export interface NoteTemplate {
  keys: string[];
  body: string;
}

/** Used when the templates folder has no file named after the type (e.g. Article.md). */
export const DEFAULT_TEMPLATES: Record<string, NoteTemplate> = {
  [TYPES.article]: {
    keys: [PROP.title, PROP.authors, PROP.journal, PROP.year, PROP.doi, PROP.arxiv, PROP.pdf, PROP.read, PROP.topics, PROP.bibtex],
    body: "## Abstract\n\n## Notes\n",
  },
  [TYPES.book]: {
    keys: [PROP.title, PROP.authors, PROP.publisher, PROP.year, PROP.isbn, PROP.doi, PROP.pdf, PROP.read, PROP.topics, PROP.bibtex],
    body: "## Description\n\n## Notes\n",
  },
  [TYPES.person]: {
    keys: [PROP.firstName, PROP.lastName, PROP.orcid, PROP.email, PROP.affiliations, PROP.relationship],
    body: "## Notes\n",
  },
  [TYPES.journal]: { keys: [PROP.abbreviation], body: "## Notes\n" },
  [TYPES.publisher]: { keys: [], body: "## Notes\n" },
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Splits a note into its YAML text (null when absent) and body. */
export function splitNote(text: string): { yaml: string | null; body: string } {
  const m = text.match(FRONTMATTER_RE);
  if (!m) return { yaml: null, body: text };
  return { yaml: m[1], body: text.slice(m[0].length) };
}

/** Reads a template file: its top-level property names, in order, and its body. */
export function parseTemplate(text: string): NoteTemplate {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/);
  const keys = (m?.[1] ?? "")
    .split(/\r?\n/)
    .map((line) => line.match(/^([^\s#-][^:]*):/)?.[1])
    .filter((key): key is string => Boolean(key) && key !== PROP.type);
  return { keys, body: m ? text.slice(m[0].length) : text };
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export interface Provenance {
  /** "Crossref" or "arXiv" */
  source: string;
  /** "DOI 10.1103/…" or "arXiv 2207.09470" */
  ident: string;
  /** ISO date of retrieval */
  date: string;
}

/** Today's date in local time, YYYY-MM-DD. */
export function localDate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Where the metadata came from: Crossref for journal DOIs, arXiv otherwise. */
export function provenanceOf(meta: { doi?: string; arxivId?: string }, date: string = localDate()): Provenance {
  const journalDoi = Boolean(meta.doi) && !/^10\.48550\/arxiv/i.test(meta.doi ?? "");
  if (journalDoi) return { source: "Crossref", ident: `DOI ${meta.doi}`, date };
  return { source: "arXiv", ident: `arXiv ${meta.arxivId ?? meta.doi ?? "?"}`, date };
}

// ---------------------------------------------------------------------------
// Body sections
// ---------------------------------------------------------------------------

/**
 * Replaces the content of a `## Heading` section, or appends the section when
 * missing. A replacer function keeps `$` in LaTeX literal.
 */
export function setSection(body: string, heading: string, content: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^## ${escaped}\\n)([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m");
  if (re.test(body)) {
    return body.replace(re, (_m, head: string) => `${head}\n${content}\n\n`).replace(/\n+$/, "\n");
  }
  return `${body.replace(/\s*$/, "")}\n\n## ${heading}\n\n${content}\n`;
}

/**
 * Abstract as a quote callout, so it stays distinct from the user's own notes;
 * the header records where and when the metadata was retrieved.
 */
export function abstractCallout(abstract: string | undefined, prov: Provenance, extraLines: string[] = []): string {
  const text = (abstract ?? "").trim() || "Not provided by the source.";
  const lines = text.split(/\n+/).map((l) => `> ${l}`);
  const extra = extraLines.length ? `\n>\n${extraLines.map((l) => `> ${l}`).join("\n")}` : "";
  return `> [!quote] ${prov.source} · ${prov.ident} · retrieved ${prov.date}\n${lines.join("\n")}${extra}`;
}

// ---------------------------------------------------------------------------
// BibTeX values
// ---------------------------------------------------------------------------

const ENTRY_HEAD = /@\s*\w+\s*[{(]\s*[^,\s]*\s*,/;
const FIELD_NAME = /^[a-z][\w:.+-]*$/i;

/**
 * Field values of a BibTeX entry, keys in lowercase. Reads nested braces, so a
 * value may span several lines or share a line with others; the outer braces
 * or quotes are removed and runs of white space become one space.
 */
export function bibtexFields(entry: string | undefined): Record<string, string> {
  const fields: Record<string, string> = {};
  const head = entry?.match(ENTRY_HEAD);
  if (!entry || !head) return fields;
  const body = entry.slice((head.index ?? 0) + head[0].length);
  let i = 0;
  const skip = (chars: string) => {
    while (i < body.length && chars.includes(body[i])) i++;
  };
  while (i < body.length) {
    skip(" \t\r\n,");
    if (i >= body.length || body[i] === "}" || body[i] === ")") break;
    const equals = body.indexOf("=", i);
    if (equals < 0) break;
    const name = body.slice(i, equals).trim().toLowerCase();
    i = equals + 1;
    skip(" \t\r\n");
    let value: string;
    if (body[i] === "{") {
      const start = i + 1;
      for (let depth = 0; i < body.length; i++) {
        if (body[i] === "{") depth++;
        else if (body[i] === "}" && --depth === 0) break;
      }
      value = body.slice(start, i);
      i++;
    } else if (body[i] === '"') {
      const end = body.indexOf('"', i + 1);
      value = body.slice(i + 1, end < 0 ? body.length : end);
      i = end < 0 ? body.length : end + 1;
    } else {
      const start = i;
      while (i < body.length && !",})\n".includes(body[i])) i++;
      value = body.slice(start, i);
    }
    if (FIELD_NAME.test(name)) fields[name] = value.replace(/\s+/g, " ").trim();
  }
  return fields;
}

/** The citation key of an entry: "@article{Key," → "Key". */
export function citekeyOf(entry: unknown): string | undefined {
  const m = typeof entry === "string" ? entry.match(/@\s*\w+\s*\{\s*([^,\s]+)\s*,/) : null;
  return m ? m[1] : undefined;
}
