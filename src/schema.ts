// ---------------------------------------------------------------------------
// Note schema of the Second Brain vault
//
// Property names, note bodies and the BibTeX/abstract sections, in one place.
// Pure module: no Obsidian imports, so it can be unit-tested with Node.
// ---------------------------------------------------------------------------

export const TYPES = { article: "Article", book: "Book", person: "Person", journal: "Journal" } as const;

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
  firstName: "First Name",
  lastName: "Last Name",
  orcid: "ORCID",
  email: "Email",
  affiliations: "Affiliations",
  relationship: "Relationship",
  abbreviation: "Abbreviation",
  aliases: "Aliases",
} as const;

export const DEFAULT_FOLDERS = {
  articles: "library/articles",
  books: "library/books",
  people: "notes/people",
  journals: "library/journals",
};

const GENERATED_COMMENT =
  "<!-- Model-written text only inside an [!ai] callout with date, model and sources. -->";

export const BODIES = {
  article: `## Abstract\n\n## My Notes\n\n## Generated Summary\n${GENERATED_COMMENT}\n\n## BibTeX\n`,
  book: "## Description\n\n## My Notes\n\n## BibTeX\n",
  person:
    "## Facts\n\n## Reported\n<!-- What others reported: always say who and when. -->\n\n" +
    '## Impressions\n<!-- Alberto\'s own impressions only, dated and in context: "- 2026-10-26 (context): ...". -->\n\n' +
    "## Links\n![[Roles.base#Person's Roles]]\n![[Projects.base#Person's Projects]]\n" +
    "![[Articles.base#Author's Articles]]\n![[Events.base#Person's Events]]\n\n## Sources\n",
  journal: "## Links\n![[Articles.base#Journal Articles]]\n",
};

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

/** The callout + fenced block that marks a BibTeX entry as verified against its source. */
export function bibtexSection(bibtex: string, prov: Provenance, extraLines: string[] = []): string {
  const callout = [`> [!info] Source: ${prov.source} · ${prov.ident} · retrieved ${prov.date}`, ...extraLines.map((l) => `> ${l}`)];
  return `${callout.join("\n")}\n\n\`\`\`bibtex\n${bibtex.trim()}\n\`\`\``;
}

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

/** Abstract as a quote callout, so it stays distinct from the user's own notes. */
export function abstractCallout(abstract: string | undefined, prov: Provenance): string {
  const text = (abstract ?? "").trim() || "Not provided by the source.";
  const lines = text.split(/\n+/).map((l) => `> ${l}`);
  return `> [!quote] ${prov.source} · retrieved ${prov.date}\n${lines.join("\n")}`;
}

/** Replaces only the fenced BibTeX block, keeping the source line (nothing was re-fetched). */
export function replaceBibtexBlock(body: string, bibtex: string): string {
  const fenced = "```bibtex\n" + bibtex.trim() + "\n```";
  const block = /```bibtex[ \t]*\n[\s\S]*?\n```/;
  return block.test(body) ? body.replace(block, () => fenced) : setSection(body, "BibTeX", fenced);
}

/** Extracts the first fenced BibTeX block of a note body, if any. */
export function bibtexFromBody(body: string): string | undefined {
  const m = body.match(/```bibtex[ \t]*\n([\s\S]*?)\n```/);
  return m ? m[1].trim() : undefined;
}

/** Field values of a BibTeX entry (outer braces or quotes removed), keys in lowercase. */
export function bibtexFields(entry: string | undefined): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!entry) return fields;
  const re = /^\s*([A-Za-z]+)\s*=\s*(.+?),?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(entry))) {
    fields[m[1].toLowerCase()] = m[2].replace(/^[{"]/, "").replace(/[}"]$/, "").trim();
  }
  return fields;
}
