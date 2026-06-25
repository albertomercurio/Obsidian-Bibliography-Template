import { requestUrl } from "obsidian";
import type { AuthorRaw, PaperMetadata } from "./types";

interface OpenLibraryEditionResponse {
  authors?: Array<{ key?: string }>;
  publishers?: string[];
  publish_date?: string;
}

interface OpenLibraryAuthorResponse {
  name?: string;
}

export class OpenLibraryService {
  async enrichBookMetadata(metadata: PaperMetadata): Promise<PaperMetadata> {
    if (metadata.itemType !== "book" || !metadata.isbn) {
      return metadata;
    }

    try {
      const edition = await this.fetchEdition(metadata.isbn);
      if (!edition) {
        return metadata;
      }

      // Crossref stays canonical for DOI imports. Open Library is only used to
      // backfill book fields that Crossref omitted, most importantly authors.
      const authors = metadata.authors.length
        ? metadata.authors
        : await this.resolveAuthors(edition.authors ?? []);

      return {
        ...metadata,
        authors,
        publisher: metadata.publisher ?? edition.publishers?.[0],
        year: metadata.year > 0 ? metadata.year : this.extractYear(edition.publish_date),
      };
    } catch {
      return metadata;
    }
  }

  private async fetchEdition(isbn: string): Promise<OpenLibraryEditionResponse | null> {
    const response = await requestUrl({
      url: `https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`,
      throw: false,
    });
    if (response.status < 200 || response.status >= 300) {
      return null;
    }

    return response.json;
  }

  private async resolveAuthors(authorRefs: Array<{ key?: string }>): Promise<AuthorRaw[]> {
    if (!authorRefs.length) {
      return [];
    }

    const authors = await Promise.all(
      authorRefs
        .map((author) => author.key)
        .filter((key): key is string => Boolean(key))
        .map(async (key) => {
          const response = await requestUrl({
            url: `https://openlibrary.org${key}.json`,
            throw: false,
          });
          if (response.status < 200 || response.status >= 300) {
            return null;
          }

          const payload: OpenLibraryAuthorResponse = response.json;
          return payload.name ? splitAuthorName(payload.name) : null;
        })
    );

    return authors.filter((author): author is AuthorRaw => author !== null);
  }

  private extractYear(publishDate?: string): number {
    if (!publishDate) {
      return 0;
    }

    const match = publishDate.match(/\b(\d{4})\b/);
    return match ? parseInt(match[1], 10) : 0;
  }
}

function splitAuthorName(fullName: string): AuthorRaw {
  // Open Library exposes a single display name, so keep the split conservative
  // and preserve the last token as family name for the existing note flow.
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { given: "", family: "" };
  }
  if (parts.length === 1) {
    return { given: "", family: parts[0] };
  }

  return {
    given: parts.slice(0, -1).join(" "),
    family: parts[parts.length - 1],
  };
}