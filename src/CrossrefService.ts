import type { AuthorRaw, PaperMetadata } from "./types";

export class CrossrefService {
  async fetchByDOI(doi: string): Promise<PaperMetadata> {
    const clean = doi
      .replace(/^https?:\/\/doi\.org\//i, "")
      .replace(/^doi:/i, "")
      .trim();

    const url = `https://api.crossref.org/works/${encodeURIComponent(clean)}`;
    const response = await fetch(url, {
      headers: { "User-Agent": "ResearchImporter/1.0 (Obsidian plugin)" },
    });

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

    const title: string = Array.isArray(work.title)
      ? work.title[0]
      : work.title ?? "Untitled";

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

    const itemType = this.resolveItemType(work.type);

    return {
      inputType: "doi",
      doi: clean,
      title,
      year,
      authors,
      journalFull: journalFull || undefined,
      journalShort: journalShort || undefined,
      volume: work.volume,
      issue: work.issue,
      pages: work.page,
      publisher: work.publisher,
      url: work.URL,
      isbn: work.ISBN?.[0]?.replace(/-/g, ""),
      itemType,
    };
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
