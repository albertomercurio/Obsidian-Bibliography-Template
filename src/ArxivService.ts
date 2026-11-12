import type { Http } from "./ports";
import type { AuthorRaw, PaperMetadata } from "./types";
import { CrossrefService } from "./CrossrefService";

export class ArxivService {
  private crossref: CrossrefService;

  constructor(private http: Http) {
    this.crossref = new CrossrefService(http);
  }

  async fetchByArxivId(rawId: string): Promise<PaperMetadata> {
    // Normalise: strip "arXiv:" prefix and version suffix
    const id = rawId
      .replace(/^arXiv:/i, "")
      .replace(/^arxiv:/i, "")
      .trim()
      .replace(/v\d+$/, "");

    // Try Semantic Scholar first (richer data, may have DOI)
    let preprint: PaperMetadata | undefined;
    try {
      const record = await this.fetchSemanticScholar(id);
      if (record.itemType !== "preprint") return record;
      preprint = record;
    } catch {
      // Semantic Scholar often refuses anonymous requests (429): arXiv below
    }

    // arXiv's own record, which names the journal DOI once the authors add it:
    // needed when Semantic Scholar failed, or knows only the preprint.
    try {
      const record = await this.fetchArxivAtom(id);
      return record.itemType === "preprint" && preprint ? preprint : record;
    } catch (err) {
      if (preprint) return preprint;
      throw err;
    }
  }

  /** The published version, from Crossref, keeping the arXiv id. */
  private async published(doi: string, id: string): Promise<PaperMetadata> {
    const meta = await this.crossref.fetchByDOI(doi);
    meta.arxivId = id;
    meta.inputType = "arxiv";
    return meta;
  }

  private async fetchSemanticScholar(id: string): Promise<PaperMetadata> {
    const url = `https://api.semanticscholar.org/graph/v1/paper/arXiv:${id}?fields=title,year,authors,externalIds,publicationVenue,journal,abstract`;
    const response = await this.http({ url });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Semantic Scholar: ${response.status}`);
    }

    const data = response.json;

    const doi: string | undefined = data.externalIds?.DOI;

    // If we have a *real* journal DOI, delegate to Crossref for maximum
    // quality. Skip arXiv proxy DOIs (10.48550/arXiv.*) — those live on
    // DataCite and would 404 on Crossref; treat the paper as a preprint.
    if (doi && !/^10\.48550\/arxiv/i.test(doi)) {
      return await this.published(doi, id);
    }

    const authors: AuthorRaw[] = (data.authors ?? []).map((a: any) => ({
      given: extractGiven(a.name),
      family: extractFamily(a.name),
    }));

    return {
      inputType: "arxiv",
      arxivId: id,
      // Every arXiv submission has a DataCite DOI (10.48550/arXiv.<id>); use the
      // one Semantic Scholar reports, else construct it.
      doi: doi ?? `10.48550/arXiv.${id}`,
      title: data.title ?? "Untitled",
      year: data.year ?? 0,
      authors,
      // arXiv is the venue for a preprint. Once it is published, the "Refresh
      // metadata" command replaces this with the real journal.
      journalFull: "arXiv",
      url: `https://arxiv.org/abs/${id}`,
      itemType: "preprint",
      abstract: data.abstract ?? undefined,
    };
  }

  private async fetchArxivAtom(id: string): Promise<PaperMetadata> {
    const feedUrl = `https://export.arxiv.org/api/query?id_list=${id}`;
    const feedResp = await this.http({ url: feedUrl });
    if (feedResp.status < 200 || feedResp.status >= 300) {
      throw new Error(
        `arXiv returned ${feedResp.status} for ID "${id}". Check that the arXiv ID is correct.`
      );
    }
    const xml = feedResp.text;

    // The journal DOI the authors gave arXiv: the published version, when
    // Crossref has it; otherwise the preprint below.
    const journalDoi = extractXmlTag(xml, "arxiv:doi");
    if (journalDoi && !/^10\.48550\/arxiv/i.test(journalDoi)) {
      try {
        return await this.published(journalDoi, id);
      } catch {
        // Crossref unreachable or without the DOI
      }
    }

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
      doi: `10.48550/arXiv.${id}`,
      title: title.trim(),
      year,
      authors,
      journalFull: "arXiv",
      url: `https://arxiv.org/abs/${id}`,
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
