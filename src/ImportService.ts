import { App, Notice, TFile } from "obsidian";
import type { AuthorRaw, PaperMetadata } from "./types";
import type { PluginSettings } from "./types";
import { CrossrefService } from "./CrossrefService";
import { ArxivService } from "./ArxivService";
import { OrcidService } from "./OrcidService";
import { generateBibtex } from "./BibtexGenerator";
import { VaultIndex, normDoi } from "./VaultIndex";
import { NoteCreator } from "./NoteCreator";
import { DisambiguationModal } from "./DisambiguationModal";

// ---------------------------------------------------------------------------
// Input detection
// ---------------------------------------------------------------------------

function detectInput(raw: string): { type: "doi" | "arxiv"; id: string } {
  const s = raw.trim();

  // DOI: starts with "10." or "doi:" or "https://doi.org/"
  if (
    /^10\.\d{4,}/i.test(s) ||
    /^doi:/i.test(s) ||
    /^https?:\/\/doi\.org\//i.test(s)
  ) {
    return { type: "doi", id: s };
  }

  // arXiv: "arXiv:XXXX.XXXXX" or just "XXXX.XXXXX" or "XXXX.XXXXXvN"
  if (/^(arxiv:)?\d{4}\.\d{4,5}(v\d+)?$/i.test(s)) {
    return { type: "arxiv", id: s };
  }

  // Fallback: treat as DOI
  return { type: "doi", id: s };
}

// ---------------------------------------------------------------------------
// ImportService
// ---------------------------------------------------------------------------

export class ImportService {
  private crossref = new CrossrefService();
  private arxiv = new ArxivService();
  private orcid = new OrcidService();

  constructor(
    private app: App,
    private settings: PluginSettings,
    private index: VaultIndex,
    private creator: NoteCreator
  ) {}

  async run(rawInput: string): Promise<void> {
    const { type, id } = detectInput(rawInput);

    // ---- 1. Fetch metadata -------------------------------------------------
    let metadata: PaperMetadata;
    try {
      new Notice("Fetching metadata…", 3000);
      metadata =
        type === "arxiv"
          ? await this.arxiv.fetchByArxivId(id)
          : await this.crossref.fetchByDOI(id);
    } catch (err: any) {
      new Notice(`❌ ${err.message}`, 7000);
      return;
    }

    // ---- 2. Duplicate check ------------------------------------------------
    if (metadata.doi) {
      const existing = this.index.doiIndex.get(normDoi(metadata.doi));
      if (existing) {
        new Notice(
          `⚠️ This paper already exists in your vault:\n"${existing.basename}"`,
          8000
        );
        // Open existing note
        this.app.workspace.openLinkText(existing.basename, "", false);
        return;
      }
    }
    if (metadata.arxivId) {
      const existing = this.index.arxivIndex.get(metadata.arxivId);
      if (existing) {
        new Notice(
          `⚠️ This paper already exists in your vault:\n"${existing.basename}"`,
          8000
        );
        this.app.workspace.openLinkText(existing.basename, "", false);
        return;
      }
    }

    // ---- 3. Resolve authors ------------------------------------------------
    const authorNames: string[] = [];
    for (const author of metadata.authors) {
      const name = await this.resolveAuthor(author);
      authorNames.push(name);
    }

    // ---- 4. Resolve journal ------------------------------------------------
    let journalName: string | undefined;
    if (metadata.journalFull) {
      journalName = await this.resolveJournal(metadata);
    }

    // ---- 5. Generate bibtex ------------------------------------------------
    const bibtex = generateBibtex({
      metadata,
      journalAbbrev: metadata.journalShort,
    });

    // ---- 6. Create note ----------------------------------------------------
    let file: TFile;
    try {
      if (metadata.itemType === "book") {
        file = await this.creator.createBook({
          metadata,
          bibtex,
          authorNames,
        });
      } else {
        file = await this.creator.createArticle({
          metadata,
          bibtex,
          authorNames,
          journalName,
        });
      }
    } catch (err: any) {
      new Notice(`❌ Could not create note: ${err.message}`, 7000);
      return;
    }

    new Notice(`✅ Imported: "${file.basename}"`, 5000);
    this.app.workspace.openLinkText(file.basename, "", "tab");
  }

  // --------------------------------------------------------------------------
  // Author resolution
  // --------------------------------------------------------------------------

  private async resolveAuthor(author: AuthorRaw): Promise<string> {
    const { given, family, orcid } = author;
    const match = this.index.findPerson(given, family, orcid);

    if (match.kind === "exact" && match.file) {
      // Update ORCID on existing file if we now have it and it didn't before
      if (orcid) await this.setOrcidIfMissing(match.file, orcid);
      return match.file.basename;
    }

    if (match.kind === "partial" && match.file) {
      const candidateFm =
        this.app.metadataCache.getFileCache(match.file)?.frontmatter;
      const candidateGiven = candidateFm?.["first_name"] ?? "";
      const candidateFamily = candidateFm?.["last_name"] ?? "";

      const modal = new DisambiguationModal(this.app, {
        entityType: "author",
        incoming: {
          label: `${given} ${family}`.trim(),
          details: orcid ? `ORCID: ${orcid}` : undefined,
        },
        candidate: {
          label: `${candidateGiven} ${candidateFamily}`.trim(),
          details: candidateFm?.["ORCiD"]
            ? `ORCID: ${candidateFm["ORCiD"]}`
            : match.reason,
        },
        allowMerge: true,
      });
      const choice = await modal.ask();

      if (choice === "same") {
        if (orcid) await this.setOrcidIfMissing(match.file, orcid);
        return match.file.basename;
      }
      if (choice === "merge") {
        return await this.creator.mergePerson(match.file, { given, family, orcid });
      }
      if (choice === "skip") {
        // No note created — the wikilink will be unresolved until dealt with manually.
        return `${given} ${family}`.trim();
      }
      // "different" → fall through to create a new note
    }

    // No match in vault. Try ORCID API if enabled.
    if (!orcid && !this.settings.skipOrcidSearch && given && family) {
      const foundOrcid = await this.tryOrcidSearch(given, family);
      if (foundOrcid) {
        return await this.creator.createPerson({
          given,
          family,
          orcid: foundOrcid,
        });
      }
    }

    return await this.creator.createPerson({ given, family, orcid });
  }

  /** Interactively search ORCID by name. Returns an ORCID if user confirms, else undefined. */
  private async tryOrcidSearch(
    given: string,
    family: string
  ): Promise<string | undefined> {
    let candidates: string[];
    try {
      candidates = await this.orcid.searchByName(given, family);
    } catch {
      return undefined; // ORCID search failed silently
    }
    if (candidates.length === 0) return undefined;

    // Fetch first candidate's record to show in disambiguation
    const orcidId = candidates[0];
    let record;
    try {
      record = await this.orcid.getRecord(orcidId);
    } catch {
      return undefined;
    }

    const modal = new DisambiguationModal(this.app, {
      entityType: "author (ORCID match)",
      incoming: {
        label: `${given} ${family}`.trim(),
        details: "From paper metadata",
      },
      candidate: {
        label:
          `${record.givenName} ${record.familyName}`.trim() ||
          "Name not public",
        details: [
          `ORCID: ${orcidId}`,
          record.affiliation ? `Affiliation: ${record.affiliation}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      },
    });
    const choice = await modal.ask();
    return choice === "same" ? orcidId : undefined;
  }

  // --------------------------------------------------------------------------
  // Journal resolution
  // --------------------------------------------------------------------------

  private async resolveJournal(metadata: PaperMetadata): Promise<string> {
    const name = metadata.journalFull!;
    const match = this.index.findJournal(name);

    if (match.kind === "exact" && match.file) {
      return match.file.basename;
    }

    // Also try by short name
    if (metadata.journalShort) {
      const shortMatch = this.index.findJournal(metadata.journalShort);
      if (shortMatch.kind === "exact" && shortMatch.file) {
        return shortMatch.file.basename;
      }
    }

    // Not found — create journal note
    return await this.creator.createJournal({
      fullName: name,
      shortName: metadata.journalShort,
    });
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private async setOrcidIfMissing(file: TFile, orcid: string): Promise<void> {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (fm?.["ORCiD"]) return; // already has one

    await this.app.fileManager.processFrontMatter(file, (fmObj) => {
      fmObj["ORCiD"] = orcid;
    });
    this.index.indexFile(file); // refresh index
  }
}
