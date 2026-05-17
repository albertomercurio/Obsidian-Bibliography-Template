import type { AuthorRaw, PaperMetadata } from "./types";
import { CrossrefService } from "./CrossrefService";

export class ArxivService {
  private crossref = new CrossrefService();

  async fetchByArxivId(rawId: string): Promise<PaperMetadata> {
    // Normalise: strip "arXiv:" prefix and version suffix
    const id = rawId
      .replace(/^arXiv:/i, "")
      .replace(/^arxiv:/i, "")
      .trim()
      .replace(/v\d+$/, "");

    // Try Semantic Scholar first (richer data, may have DOI)
    try {
      return await this.fetchSemanticScholar(id);
    } catch {
      // Fall back to arXiv Atom API
      return await this.fetchArxivAtom(id);
    }
  }

  private async fetchSemanticScholar(id: string): Promise<PaperMetadata> {
    const url = `https://api.semanticscholar.org/graph/v1/paper/arXiv:${id}?fields=title,year,authors,externalIds,publicationVenue,journal,abstract`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Semantic Scholar: ${response.status}`);
    }

    const data = await response.json();

    const doi: string | undefined = data.externalIds?.DOI;

    // If we have a DOI, delegate to Crossref for maximum quality
    if (doi) {
      const meta = await this.crossref.fetchByDOI(doi);
      // Keep arXiv ID even if published
      meta.arxivId = id;
      meta.inputType = "arxiv";
      return meta;
    }

    const authors: AuthorRaw[] = (data.authors ?? []).map((a: any) => ({
      given: extractGiven(a.name),
      family: extractFamily(a.name),
    }));

    return {
      inputType: "arxiv",
      arxivId: id,
      title: data.title ?? "Untitled",
      year: data.year ?? 0,
      authors,
      journalFull:
        data.publicationVenue?.name ?? data.journal?.name ?? undefined,
      itemType: "preprint",
      abstract: data.abstract ?? undefined,
    };
  }

  private async fetchArxivAtom(id: string): Promise<PaperMetadata> {
    const feedUrl = `https://export.arxiv.org/api/query?id_list=${id}`;
    const feedResp = await fetch(feedUrl);
    if (!feedResp.ok) {
      throw new Error(
        `arXiv returned ${feedResp.status} for ID "${id}". Check that the arXiv ID is correct.`
      );
    }
    const xml = await feedResp.text();

    const title = extractXmlTag(xml, "title", 1) ?? "Untitled";
    const summary = extractXmlTag(xml, "summary");
    const published = extractXmlTag(xml, "published") ?? "";
    const year = published ? parseInt(published.substring(0, 4), 10) : 0;

    const authorMatches = [...xml.matchAll(/<author>[^]*?<name>([^<]+)<\/name>/g)];
    const authors: AuthorRaw[] = authorMatches.map((m) => ({
      given: extractGiven(m[1]),
      family: extractFamily(m[1]),
    }));

    return {
      inputType: "arxiv",
      arxivId: id,
      title: title.trim(),
      year,
      authors,
      itemType: "preprint",
      abstract: summary ?? undefined,
    };
  }
}

// ---- helpers ----------------------------------------------------------------

function extractXmlTag(xml: string, tag: string, skip = 0): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "g");
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (i++ === skip) return m[1].trim();
  }
  return undefined;
}

/** "John W. Smith" -> "John W." */
function extractGiven(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts.slice(0, -1).join(" ");
}

/** "John W. Smith" -> "Smith" */
function extractFamily(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1];
}
