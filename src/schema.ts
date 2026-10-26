// ---------------------------------------------------------------------------
// Note schema profiles
//
// The plugin writes the same information into vaults that name it differently.
// A profile maps the plugin's logical fields to the vault's property names and
// decides where the BibTeX entry lives. Pure module: no Obsidian imports, so it
// can be unit-tested with Node.
// ---------------------------------------------------------------------------

export type ProfileId = "legacy" | "second-brain";

export interface SchemaProfile {
  id: ProfileId;
  label: string;
  folders: { articles: string; books: string; people: string; journals: string };
  types: { article: string; book: string; person: string; journal: string };
  keys: {
    type: string;
    title: string;
    authors: string;
    journal: string;
    year: string;
    doi: string;
    arxiv: string;
    url: string;
    pdf: string;
    read: string;
    isbn: string;
    publisher: string;
    topics: string | null;
    firstName: string;
    lastName: string;
    orcid: string;
    email: string | null;
    affiliations: string | null;
    relationship: string | null;
    journalFullName: string | null;
    journalAbbreviation: string | null;
    aliases: string;
  };
  /** Frontmatter property holding the BibTeX entry, or null to keep it in the note body. */
  bibtexProperty: string | null;
  /** Write `url` only when there is no DOI (the DOI already resolves). */
  urlOnlyWithoutDoi: boolean;
  /** Add eprint/archivePrefix to published articles that also have an arXiv id. */
  eprintForArticles: boolean;
  /** Built-in note bodies; null means "read the vault's template notes". */
  bodies: { article: string; book: string; person: string; journal: string } | null;
  /** Template note basenames, used when `bodies` is null. */
  templateNames: { article: string; book: string; person: string; journal: string };
}

export const LEGACY_PROFILE: SchemaProfile = {
  id: "legacy",
  label: "Legacy (Research vault)",
  folders: { articles: "Articles", books: "Books", people: "People", journals: "Journals" },
  types: { article: "Article", book: "Book", person: "Person", journal: "Journal" },
  keys: {
    type: "type",
    title: "title",
    authors: "authors",
    journal: "journal",
    year: "year",
    doi: "doi",
    arxiv: "arxiv_id",
    url: "url",
    pdf: "pdf",
    read: "read",
    isbn: "isbn",
    publisher: "publisher",
    topics: null,
    firstName: "first_name",
    lastName: "last_name",
    orcid: "ORCiD",
    email: null,
    affiliations: null,
    relationship: null,
    journalFullName: "full_name",
    journalAbbreviation: null,
    aliases: "aliases",
  },
  bibtexProperty: "bibtex",
  urlOnlyWithoutDoi: false,
  eprintForArticles: false,
  bodies: null,
  templateNames: {
    article: "Article Template",
    book: "Book Template",
    person: "Person Template",
    journal: "Journal Template",
  },
};

const GENERATED_COMMENT =
  "<!-- Model-written text only inside an [!ai] callout with date, model and sources. -->";

export const SECOND_BRAIN_PROFILE: SchemaProfile = {
  id: "second-brain",
  label: "Second Brain 0.3",
  folders: {
    articles: "library/articles",
    books: "library/books",
    people: "notes/people",
    journals: "library/journals",
  },
  types: { article: "Article", book: "Book", person: "Person", journal: "Journal" },
  keys: {
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
    journalFullName: null,
    journalAbbreviation: "Abbreviation",
    aliases: "Aliases",
  },
  bibtexProperty: null,
  urlOnlyWithoutDoi: true,
  eprintForArticles: true,
  bodies: {
    article: `## Abstract\n\n## My Notes\n\n## Generated Summary\n${GENERATED_COMMENT}\n\n## BibTeX\n`,
    book: "## Description\n\n## My Notes\n\n## BibTeX\n",
    person:
      "## Facts\n\n## Reported\n<!-- What others reported: always say who and when. -->\n\n" +
      '## Impressions\n<!-- Alberto\'s own impressions only, dated and in context: "- 2026-10-26 (context): ...". -->\n\n' +
      "## Links\n![[Roles.base#Person's Roles]]\n![[Projects.base#Person's Projects]]\n" +
      "![[Articles.base#Author's Articles]]\n![[Events.base#Person's Events]]\n\n## Sources\n",
    journal: "## Links\n![[Articles.base#Journal Articles]]\n",
  },
  templateNames: LEGACY_PROFILE.templateNames,
};

export const PROFILES: Record<ProfileId, SchemaProfile> = {
  legacy: LEGACY_PROFILE,
  "second-brain": SECOND_BRAIN_PROFILE,
};

export function profileFor(id: string | undefined): SchemaProfile {
  return PROFILES[(id as ProfileId) ?? "legacy"] ?? LEGACY_PROFILE;
}

// ---------------------------------------------------------------------------
// Body helpers (Second Brain profile)
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
export function provenanceOf(
  meta: { doi?: string; arxivId?: string; journalFull?: string },
  date: string = localDate()
): Provenance {
  const journalDoi = Boolean(meta.doi) && !/^10\.48550\/arxiv/i.test(meta.doi ?? "");
  if (journalDoi) return { source: "Crossref", ident: `DOI ${meta.doi}`, date };
  return { source: "arXiv", ident: `arXiv ${meta.arxivId ?? meta.doi ?? "?"}`, date };
}

/** BibTeX style options of a profile, for generateBibtex(). */
export function bibtexStyle(profile: SchemaProfile): { omitUrlWithDoi: boolean; eprintForArticles: boolean } {
  return { omitUrlWithDoi: profile.urlOnlyWithoutDoi, eprintForArticles: profile.eprintForArticles };
}

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

/** Extracts the first fenced BibTeX block of a note body, if any. */
export function bibtexFromBody(body: string): string | undefined {
  const m = body.match(/```bibtex[ \t]*\n([\s\S]*?)\n```/);
  return m ? m[1].trim() : undefined;
}
