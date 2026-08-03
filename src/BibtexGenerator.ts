import type { PaperMetadata } from "./types";

// ---------------------------------------------------------------------------
// Unicode → LaTeX encoding table (used only inside the bibtex string)
// ---------------------------------------------------------------------------
const LATEX_MAP: Record<string, string> = {
  À: "\\`{A}", Á: "\\'{A}", Â: "\\^{A}", Ã: "\\~{A}", Ä: '\\"{A}',
  Å: "{\\AA}", Æ: "{\\AE}", Ç: "\\c{C}",
  È: "\\`{E}", É: "\\'{E}", Ê: "\\^{E}", Ë: '\\"{E}',
  Ì: "\\`{I}", Í: "\\'{I}", Î: "\\^{I}", Ï: '\\"{I}',
  Ñ: "\\~{N}",
  Ò: "\\`{O}", Ó: "\\'{O}", Ô: "\\^{O}", Õ: "\\~{O}", Ö: '\\"{O}',
  Ø: "{\\O}", Œ: "{\\OE}",
  Ù: "\\`{U}", Ú: "\\'{U}", Û: "\\^{U}", Ü: '\\"{U}',
  Ý: "\\'{Y}",
  ß: "{\\ss}",
  à: "\\`{a}", á: "\\'{a}", â: "\\^{a}", ã: "\\~{a}", ä: '\\"{a}',
  å: "{\\aa}", æ: "{\\ae}", ç: "\\c{c}",
  è: "\\`{e}", é: "\\'{e}", ê: "\\^{e}", ë: '\\"{e}',
  ì: "\\`{i}", í: "\\'{i}", î: "\\^{i}", ï: '\\"{i}',
  ñ: "\\~{n}",
  ò: "\\`{o}", ó: "\\'{o}", ô: "\\^{o}", õ: "\\~{o}", ö: '\\"{o}',
  ø: "{\\o}", œ: "{\\oe}",
  ù: "\\`{u}", ú: "\\'{u}", û: "\\^{u}", ü: '\\"{u}',
  ý: "\\'{y}", ÿ: '\\"{y}',
};

function toLatex(s: string): string {
  return [...s].map((ch) => LATEX_MAP[ch] ?? ch).join("");
}

// ---------------------------------------------------------------------------
// Cite-key helpers
// ---------------------------------------------------------------------------
const STOP_WORDS = new Set([
  "a", "an", "the", "of", "in", "on", "at", "to", "for", "and", "or",
  "but", "with", "from", "by", "as", "is", "are", "was", "were",
]);

function titleWords(title: string, count = 3): string {
  return title
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w.toLowerCase()))
    .slice(0, count)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

function sanitizeKey(s: string): string {
  // Remove all non-ASCII and non-alphanumeric characters
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "");
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------
export interface BibtexOptions {
  metadata: PaperMetadata;
  /** The wikilink display name of the journal, used for the abbreviated field */
  journalAbbrev?: string;
}

export function generateBibtex(opts: BibtexOptions): string {
  const { metadata } = opts;

  const firstAuthor = metadata.authors[0];
  const firstFamily = firstAuthor
    ? sanitizeKey(firstAuthor.family)
    : metadata.itemType === "book"
    ? sanitizeKey(metadata.publisher ?? "Book")
    : "Unknown";
  const year = metadata.year > 0 ? String(metadata.year) : "XXXX";
  const words = titleWords(metadata.title);
  const citeKey = `${firstFamily}${year}${words}`;

  // Author field in LaTeX format: "Family, Given and Family, Given"
  const authorField = metadata.authors
    .map((a) => {
      const family = toLatex(a.family);
      const given = toLatex(a.given);
      return given ? `${family}, ${given}` : family;
    })
    .join(" and ");

  const journalField =
    opts.journalAbbrev ?? metadata.journalShort ?? metadata.journalFull ?? "";

  const entryType =
    metadata.itemType === "preprint"
      ? "misc"
      : metadata.itemType === "book"
      ? "book"
      : "article";

  const fields: [string, string | undefined][] = [];

  if (entryType === "article") {
    if (authorField) fields.push(["author", authorField]);
    // NOTE: bibtex titles are displayed verbatim in reference managers and
    // compiled documents — accuracy matters. titleLatex preserves math symbols
    // as proper LaTeX (e.g. $\mathbb{Z}_{3}$); fall back to plain text only
    // when no LaTeX version is available.
    fields.push(["title", `{${toLatex(metadata.titleLatex ?? metadata.title)}}`]);
    fields.push(["journal", journalField]);
    fields.push(["year", year]);
    if (metadata.volume) fields.push(["volume", metadata.volume]);
    if (metadata.issue) fields.push(["number", metadata.issue]);
    if (metadata.pages) fields.push(["pages", metadata.pages]);
    if (metadata.doi) fields.push(["doi", metadata.doi]);
    if (metadata.url) fields.push(["url", metadata.url]);
  } else if (entryType === "book") {
    if (authorField) fields.push(["author", authorField]);
    fields.push(["title", `{${toLatex(metadata.title)}}`]);
    if (metadata.publisher) fields.push(["publisher", toLatex(metadata.publisher)]);
    fields.push(["year", year]);
    if (metadata.isbn) fields.push(["isbn", metadata.isbn]);
    if (metadata.url) fields.push(["url", metadata.url]);
  } else {
    // preprint / misc
    if (authorField) fields.push(["author", authorField]);
    fields.push(["title", `{${toLatex(metadata.title)}}`]);
    fields.push(["year", year]);
    if (metadata.arxivId) {
      fields.push(["eprint", metadata.arxivId]);
      fields.push(["archivePrefix", "arXiv"]);
      fields.push(["primaryClass", ""]); // caller can update
    }
    if (metadata.doi) fields.push(["doi", metadata.doi]);
    if (metadata.url) fields.push(["url", metadata.url]);
    fields.push(["note", "Preprint"]);
  }

  const fieldLines = fields
    .filter((f): f is [string, string] => f[1] !== undefined && f[1] !== "")
    .map(([k, v]) => `  ${k} = {${v}}`)
    .join(",\n");

  return `@${entryType}{${citeKey},\n${fieldLines}\n}`;
}
