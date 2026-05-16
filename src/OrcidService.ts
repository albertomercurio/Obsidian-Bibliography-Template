export interface OrcidRecord {
  orcid: string;
  givenName: string;
  familyName: string;
  /** Current primary affiliation, if public */
  affiliation?: string;
  /** Verified email domain, if public */
  emailDomain?: string;
}

export class OrcidService {
  private readonly BASE = "https://pub.orcid.org/v3.0";
  private readonly HEADERS = {
    Accept: "application/json",
    "User-Agent": "ResearchImporter/1.0 (Obsidian plugin)",
  };

  /**
   * Search for possible ORCIDs by author name.
   * Returns up to 5 ORCID identifiers without full records.
   */
  async searchByName(given: string, family: string): Promise<string[]> {
    // Build a tolerant query: exact family name, given name can be abbreviated
    const familyQ = encodeURIComponent(family.trim());
    // Use the first word of "given" to handle both "John" and "J."
    const givenFirst = given.trim().split(/\s+/)[0].replace(/\.$/, "");
    const givenQ = encodeURIComponent(givenFirst);

    const url = `${this.BASE}/search/?q=family-name:${familyQ}+AND+given-names:${givenQ}&rows=5`;
    const response = await fetch(url, { headers: this.HEADERS });

    if (!response.ok) {
      throw new Error(`ORCID search failed: ${response.status}`);
    }

    // Response is XML despite Accept header (ORCID quirk for search endpoint)
    const text = await response.text();
    const matches = [...text.matchAll(/<common:path>([^<]+)<\/common:path>/g)];
    return matches.map((m) => m[1].trim());
  }

  /**
   * Fetch the public record for a known ORCID.
   * Uses the /person endpoint which is always public for minimal profile data.
   */
  async getRecord(orcid: string): Promise<OrcidRecord> {
    const url = `${this.BASE}/${orcid}/person`;
    const response = await fetch(url, { headers: this.HEADERS });

    if (!response.ok) {
      throw new Error(
        `ORCID record fetch failed for ${orcid}: ${response.status}`
      );
    }

    const data = await response.json();

    const givenName: string =
      data.name?.["given-names"]?.value ?? "";
    const familyName: string =
      data.name?.["family-name"]?.value ?? "";

    const affiliations: any[] =
      data["affiliations"]?.["employment-summary"] ?? [];
    const affiliation: string | undefined =
      affiliations[0]?.organization?.name;

    return { orcid, givenName, familyName, affiliation };
  }
}
