import { MathMLToLaTeX } from "mathml-to-latex";
import type { AuthorRaw, PaperMetadata } from "./types";
import { OpenLibraryService } from "./OpenLibraryService";

// ---------------------------------------------------------------------------
// Markup helpers
// ---------------------------------------------------------------------------

/**
 * Converts MathML fragments embedded in a string to inline LaTeX ($...$),
 * then strips any remaining XML tags and decodes HTML entities.
 * Used for bibtex title and note abstract.
 */
function convertMathML(raw: string): string {
  // Replace each <prefix:math ...>...</prefix:math> block with $latex$
  const withLatex = raw.replace(
    /<([a-z]+):math[\s\S]*?<\/\1:math>/gi,
    (block, prefix) => {
      const unprefixed = block.replace(new RegExp(`\\b${prefix}:`, "g"), "");
      try {
        const latex = MathMLToLaTeX.convert(unprefixed);
        return `$${latex}$`;
      } catch {
        // Fall back to plain text if conversion fails
        return block.replace(/<[^>]*>/g, " ");
      }
    }
  );
  // Strip any remaining structural XML (e.g. JATS <jats:p>), decode entities,
  // and normalise whitespace
  return withLatex
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#([0-9]+);/g, (_, dec) =>
      String.fromCodePoint(parseInt(dec, 10))
    )
    .replace(/\s+/g, " ")
    .trim();
}

function cleanMarkup(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, "")          // strip all XML/HTML tags (MathML, JATS…)
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#([0-9]+);/g, (_, dec) =>
      String.fromCodePoint(parseInt(dec, 10))
    )
    .replace(/\s+/g, " ")             // collapse all whitespace to single space
    .trim();
}

// ---------------------------------------------------------------------------
// CrossrefService
// ---------------------------------------------------------------------------

export class CrossrefService {
  // Some Crossref book records contain DOI, title, year, and ISBN but omit the
  // people fields entirely. For those cases we try a secondary ISBN lookup.
  private openLibrary = new OpenLibraryService();

  async fetchByDOI(doi: string): Promise<PaperMetadata> {
    const clean = doi
      .replace(/^https?:\/\/doi\.org\//i, "")
      .replace(/^doi:/i, "")
      .trim();

    const url = `https://api.crossref.org/works/${encodeURIComponent(clean)}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Crossref returned ${response.status} for DOI "${clean}". Check that the DOI is correct.`
      );
    }

    const json = await response.json();
    const work = json.message;

    const authors: AuthorRaw[] = (work.author ?? []).map((a: any) => ({
      given: a.given ?? "",
      family: a.family ?? "",
      orcid: a.ORCID
        ? a.ORCID.replace("http://orcid.org/", "").replace(
            "https://orcid.org/",
            ""
          )
        : undefined,
    }));

    const rawTitle: string = Array.isArray(work.title)
      ? work.title[0]
      : work.title ?? "Untitled";
    const title: string = cleanMarkup(rawTitle);
    // titleLatex preserves math as inline LaTeX for use in .bib files
    const titleLatex: string = convertMathML(rawTitle);

    const abstract: string | undefined = work.abstract
      ? convertMathML(work.abstract)
      : undefined;

    const year: number =
      work.published?.["date-parts"]?.[0]?.[0] ??
      work["published-print"]?.["date-parts"]?.[0]?.[0] ??
      work["published-online"]?.["date-parts"]?.[0]?.[0] ??
      0;

    const journalFull: string | undefined = Array.isArray(
      work["container-title"]
    )
      ? work["container-title"][0]
      : work["container-title"];

    const journalShort: string | undefined = Array.isArray(
      work["short-container-title"]
    )
      ? work["short-container-title"][0]
      : work["short-container-title"];

    const pages: string | undefined = work.page ?? work["article-number"];

    const itemType = this.resolveItemType(work.type);

    const metadata: PaperMetadata = {
      inputType: "doi",
      doi: clean,
      title,
      year,
      authors,
      journalFull: journalFull || undefined,
      journalShort: journalShort || undefined,
      volume: work.volume,
      issue: work.issue,
      pages,
      publisher: work.publisher,
      url: work.URL,
      isbn: work.ISBN?.[0]?.replace(/-/g, ""),
      itemType,
      abstract,
      titleLatex,
    };

    if (metadata.itemType === "book" && metadata.authors.length === 0 && metadata.isbn) {
      // Keep the DOI payload as the primary source and enrich only when the
      // book record is missing authors but still gives us an ISBN to resolve.
      return await this.openLibrary.enrichBookMetadata(metadata);
    }

    return metadata;
  }

  private resolveItemType(
    crossrefType: string
  ): "article" | "book" | "preprint" {
    if (!crossrefType) return "article";
    if (
      crossrefType.includes("book") ||
      crossrefType === "monograph" ||
      crossrefType === "edited-book"
    )
      return "book";
    if (crossrefType === "posted-content") return "preprint";
    return "article";
  }
}
