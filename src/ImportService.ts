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
import { AuthorOverflowModal } from "./AuthorOverflowModal";
import { additiveFields, planAuthorMerge, type MergeField } from "./AuthorMerge";

type DeferredImportAction = () => Promise<void>;

const OVERFLOW_VISIBLE_AUTHORS = 1;

interface PlannedEntityResolution {
  displayName: string;
  actions: DeferredImportAction[];
}

// ---------------------------------------------------------------------------
// Input detection
// ---------------------------------------------------------------------------

function detectInput(raw: string): { type: "doi" | "arxiv"; id: string } {
  const s = raw.trim();

  // arXiv proxy DOI (registered with DataCite, not Crossref):
  // "10.48550/arXiv.2603.13030" → arXiv id "2603.13030". Must be checked
  // BEFORE the generic DOI rule below, which would otherwise swallow it.
  const arxivDoi = s.match(
    /^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?10\.48550\/arxiv\.(.+)$/i
  );
  if (arxivDoi) {
    return { type: "arxiv", id: arxivDoi[1] };
  }

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

function formatFetchError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "Unknown error");
  const lower = message.toLowerCase();

  if (lower.includes("failed to fetch") || lower.includes("load failed") || lower.includes("network")) {
    return "Network request failed. On mobile/iPad, check internet access and try again.";
  }

  return message;
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
    } catch (err: unknown) {
      new Notice(`❌ ${formatFetchError(err)}`, 7000);
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

    const visibleAuthors = await this.getVisibleAuthors(metadata);
    if (visibleAuthors === null) {
      new Notice("Import canceled. No article note was created.", 5000);
      return;
    }

    // ---- 3. Resolve authors ------------------------------------------------
    const authorNames: string[] = [];
    const deferredActions: DeferredImportAction[] = [];
    for (const author of visibleAuthors) {
      const resolution = await this.resolveAuthor(author);
      if (resolution === null) {
        new Notice("Import canceled. No article note was created.", 5000);
        return;
      }
      authorNames.push(resolution.displayName);
      deferredActions.push(...resolution.actions);
    }

    // ---- 4. Resolve journal ------------------------------------------------
    let journalName: string | undefined;
    if (metadata.journalFull) {
      const resolvedJournal = await this.resolveJournal(metadata);
      if (resolvedJournal === null) {
        new Notice("Import canceled. No article note was created.", 5000);
        return;
      }
      journalName = resolvedJournal.displayName;
      deferredActions.push(...resolvedJournal.actions);
    }

    // ---- 5. Generate bibtex ------------------------------------------------
    const bibtex = generateBibtex({
      metadata,
      journalAbbrev: metadata.journalShort,
    });

    // ---- 6. Create note ----------------------------------------------------
    let file: TFile;
    try {
      if (this.creator.publicationFileExists(metadata)) {
        throw new Error("A note with the same filename already exists.");
      }

      for (const action of deferredActions) {
        await action();
      }

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
    this.app.workspace.openLinkText(file.basename, "", false);
  }

  // --------------------------------------------------------------------------
  // Refresh: promote a preprint note to its published version
  // --------------------------------------------------------------------------

  async refreshActiveNote(file: TFile): Promise<void> {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const arxivId: string | undefined = fm?.["arxiv_id"]
      ? String(fm["arxiv_id"]).trim()
      : undefined;

    if (fm?.["type"] !== "Article" || !arxivId) {
      new Notice(
        "Refresh only works on arXiv-sourced article notes (need an arxiv_id).",
        6000
      );
      return;
    }

    // ---- Re-fetch metadata -------------------------------------------------
    let metadata: PaperMetadata;
    try {
      new Notice("Checking for published version…", 3000);
      metadata = await this.arxiv.fetchByArxivId(arxivId);
    } catch (err: unknown) {
      new Notice(`❌ ${formatFetchError(err)}`, 7000);
      return;
    }

    // ---- Detect preprint → published transition ----------------------------
    // A preprint carries the arXiv DOI (10.48550/arXiv.*) and journal "[[arXiv]]".
    // A real journal DOI from the fetch means it has now been published.
    const fetchedJournalDoi =
      !!metadata.doi && !/^10\.48550\/arxiv/i.test(metadata.doi);
    const currentDoi = fm["doi"] ? String(fm["doi"]) : "";
    const alreadyPublished =
      !!currentDoi && !/^10\.48550\/arxiv/i.test(currentDoi);
    if (!fetchedJournalDoi || !metadata.journalFull || alreadyPublished) {
      new Notice("No publication update found — still a preprint.", 5000);
      return;
    }

    // ---- Resolve journal (create the note if missing) ----------------------
    const resolvedJournal = await this.resolveJournal(metadata);
    if (resolvedJournal === null) {
      new Notice("Refresh canceled. The note was not changed.", 5000);
      return;
    }
    for (const action of resolvedJournal.actions) {
      await action();
    }

    // ---- Regenerate bibtex (@misc → @article) ------------------------------
    const bibtex = generateBibtex({
      metadata,
      journalAbbrev: metadata.journalShort,
    });

    // ---- Write back --------------------------------------------------------
    await this.app.fileManager.processFrontMatter(file, (fmObj) => {
      fmObj["doi"] = metadata.doi ?? null;
      fmObj["journal"] = `[[${resolvedJournal.displayName}]]`;
      fmObj["year"] = metadata.year > 0 ? metadata.year : fmObj["year"] ?? null;
      fmObj["url"] = metadata.url ?? fmObj["url"] ?? null;
      fmObj["bibtex"] = bibtex;
    });
    this.index.indexFile(file);

    new Notice(
      `✅ Updated to published version: "${resolvedJournal.displayName}"`,
      6000
    );
  }

  private async getVisibleAuthors(
    metadata: PaperMetadata
  ): Promise<AuthorRaw[] | null> {
    const maxAuthors = Math.max(0, this.settings.maxAuthors ?? 0);
    if (maxAuthors === 0 || metadata.authors.length <= maxAuthors) {
      return metadata.authors;
    }

    const confirmed = await new AuthorOverflowModal(
      this.app,
      metadata.authors.length,
      maxAuthors,
      OVERFLOW_VISIBLE_AUTHORS
    ).ask();

    if (!confirmed) {
      return null;
    }

    return metadata.authors.slice(0, OVERFLOW_VISIBLE_AUTHORS);
  }

  // --------------------------------------------------------------------------
  // Author resolution
  // --------------------------------------------------------------------------

  private async resolveAuthor(
    author: AuthorRaw
  ): Promise<PlannedEntityResolution | null> {
    const { given, family, orcid } = author;
    const match = this.index.findPerson(given, family, orcid);

    if (match.kind === "exact" && match.file) {
      return this.reuseExisting(match.file, author);
    }

    if (match.kind === "partial" && match.file) {
      const candidate = this.personFields(match.file);
      const plan = planAuthorMerge(candidate, author);

      const modal = new DisambiguationModal(this.app, {
        entityType: "author",
        incoming: {
          label: `${given} ${family}`.trim(),
          details: orcid ? `ORCID: ${orcid}` : undefined,
        },
        candidate: {
          label: `${candidate.given} ${candidate.family}`.trim(),
          details: candidate.orcid ? `ORCID: ${candidate.orcid}` : match.reason,
        },
        mergePlan: plan,
        candidateBasename: match.file.basename,
      });
      const { choice, mergeFields } = await modal.ask();

      if (choice === "abort") {
        return null;
      }
      if (choice === "same") {
        return this.reuseExisting(match.file, author);
      }
      if (choice === "merge") {
        const plannedMerge = this.creator.planMergePerson(
          match.file,
          mergeFields ?? plan
        );
        return {
          displayName: plannedMerge.basename,
          actions: [async () => {
            await plannedMerge.commit();
          }],
        };
      }
      if (choice === "skip") {
        // No note created — the wikilink will be unresolved until dealt with manually.
        return {
          displayName: `${given} ${family}`.trim(),
          actions: [],
        };
      }
      // "different" → fall through to create a new note
    }

    // No match in vault. Try ORCID API if enabled.
    if (!orcid && !this.settings.skipOrcidSearch && given && family) {
      const foundOrcid = await this.tryOrcidSearch(given, family);
      if (foundOrcid === null) {
        return null;
      }
      if (foundOrcid) {
        const plannedPerson = this.creator.planCreatePerson({
          given,
          family,
          orcid: foundOrcid,
        });
        return {
          displayName: plannedPerson.basename,
          actions: [async () => {
            await plannedPerson.commit();
          }],
        };
      }
    }

    const plannedPerson = this.creator.planCreatePerson({ given, family, orcid });
    return {
      displayName: plannedPerson.basename,
      actions: [async () => {
        await plannedPerson.commit();
      }],
    };
  }

  /** Interactively search ORCID by name. Returns an ORCID if user confirms, else undefined. */
  private async tryOrcidSearch(
    given: string,
    family: string
  ): Promise<string | undefined | null> {
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
    const { choice } = await modal.ask();
    if (choice === "abort") {
      return null;
    }
    return choice === "same" ? orcidId : undefined;
  }

  // --------------------------------------------------------------------------
  // Journal resolution
  // --------------------------------------------------------------------------

  private async resolveJournal(
    metadata: PaperMetadata
  ): Promise<PlannedEntityResolution | null> {
    const name = metadata.journalFull!;
    const match = this.index.findJournal(name);

    if (match.kind === "exact" && match.file) {
      return { displayName: match.file.basename, actions: [] };
    }

    // Also try by short name
    if (metadata.journalShort) {
      const shortMatch = this.index.findJournal(metadata.journalShort);
      if (shortMatch.kind === "exact" && shortMatch.file) {
        return { displayName: shortMatch.file.basename, actions: [] };
      }
    }

    // Not found — create journal note
    const plannedJournal = this.creator.planCreateJournal({
      fullName: name,
      shortName: metadata.journalShort,
    });
    return {
      displayName: plannedJournal.basename,
      actions: [async () => {
        await plannedJournal.commit();
      }],
    };
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /** Reads the Person frontmatter this plugin manages off an existing note. */
  private personFields(file: TFile): {
    given: string;
    family: string;
    orcid: string;
  } {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return {
      given: fm?.["first_name"] ?? "",
      family: fm?.["last_name"] ?? "",
      orcid: fm?.["ORCiD"] ?? "",
    };
  }

  /**
   * Links to an existing Person note, filling in only the fields that note
   * leaves empty (typically a missing ORCID). Never replaces existing values —
   * that is what the explicit "merge" choice is for.
   */
  private reuseExisting(
    file: TFile,
    author: AuthorRaw
  ): PlannedEntityResolution {
    return {
      displayName: file.basename,
      actions: [async () => {
        // Re-read at commit time: an earlier author in the same import may
        // already have touched this note.
        const fields: MergeField[] = additiveFields(
          planAuthorMerge(this.personFields(file), author)
        );
        await this.creator.applyPersonFields(file, fields);
      }],
    };
  }
}
