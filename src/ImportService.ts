import type { Http, NoteRef, Ui, VaultPort } from "./ports";
import type { AuthorRaw, PaperMetadata } from "./types";
import type { PluginSettings } from "./types";
import { CrossrefService } from "./CrossrefService";
import { ArxivService } from "./ArxivService";
import { OrcidService } from "./OrcidService";
import { generateBibtex } from "./BibtexGenerator";
import { VaultIndex, normDoi } from "./VaultIndex";
import { NoteCreator } from "./NoteCreator";
import { additiveFields, planAuthorMerge, type MergeField } from "./AuthorMerge";
import { citekeyOf, PROP, provenanceOf, TYPES, type Provenance } from "./schema";

type DeferredImportAction = () => Promise<void>;

const OVERFLOW_VISIBLE_AUTHORS = 1;

interface PlannedEntityResolution {
  displayName: string;
  actions: DeferredImportAction[];
}

// ---------------------------------------------------------------------------
// Input detection
// ---------------------------------------------------------------------------

/** An arXiv id without its prefix and version: "arXiv:2207.09470v2" → "2207.09470". */
function bareArxiv(id: string): string {
  return id.trim().replace(/^arxiv:\s*/i, "").replace(/v\d+$/i, "");
}

/**
 * A DOI as given, or an arXiv id without prefix and version. Also takes what is
 * often pasted instead: doi.org and dx.doi.org links, arxiv.org pages and PDFs.
 */
export function detectInput(raw: string): { type: "doi" | "arxiv"; id: string } {
  const s = raw.trim();

  // arXiv proxy DOI (registered with DataCite, not Crossref):
  // "10.48550/arXiv.2603.13030" → arXiv id "2603.13030". Must be checked
  // BEFORE the generic DOI rule below, which would otherwise swallow it.
  const arxivDoi = s.match(
    /^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?10\.48550\/arxiv\.(.+)$/i
  );
  if (arxivDoi) {
    return { type: "arxiv", id: bareArxiv(arxivDoi[1]) };
  }

  // arXiv page or PDF: "https://arxiv.org/abs/2207.09470v2", ".../pdf/2207.09470.pdf"
  const arxivLink = s.match(
    /^https?:\/\/(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf|html)\/(.+?)(?:\.pdf)?\/?$/i
  );
  if (arxivLink) {
    return { type: "arxiv", id: bareArxiv(arxivLink[1]) };
  }

  // DOI: starts with "10." or "doi:" or a doi.org link
  if (
    /^10\.\d{4,}/i.test(s) ||
    /^doi:/i.test(s) ||
    /^https?:\/\/(?:dx\.)?doi\.org\//i.test(s)
  ) {
    return { type: "doi", id: s };
  }

  // arXiv: "2207.09470", "arXiv:2207.09470v2", and ids before 2007:
  // "quant-ph/0101001", "math.GT/0309136v1"
  if (/^(arxiv:\s*)?(\d{4}\.\d{4,5}|[a-z-]+(\.[a-z]{2})?\/\d{7})(v\d+)?$/i.test(s)) {
    return { type: "arxiv", id: bareArxiv(s) };
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

export interface ImportOptions {
  /** Topic note names to link from the new article. */
  topics?: string[];
  /** arXiv id of the preprint, when importing the published version by DOI. */
  arxivId?: string;
}

export class ImportService {
  /** After `run`: the note of the paper, when the vault already had it. */
  existing: NoteRef | null = null;
  private crossref: CrossrefService;
  private arxiv: ArxivService;
  private orcid: OrcidService;

  constructor(
    private vault: VaultPort,
    private ui: Ui,
    http: Http,
    private settings: PluginSettings,
    private index: VaultIndex,
    private creator: NoteCreator
  ) {
    this.crossref = new CrossrefService(http);
    this.arxiv = new ArxivService(http);
    this.orcid = new OrcidService(http);
  }

  /**
   * Fetches the record of a DOI or arXiv id. Its text comes from outside and ends
   * up in a new note, where Templater would run any "<% %>" command: defuse them.
   */
  async fetch(rawInput: string): Promise<PaperMetadata> {
    const { type, id } = detectInput(rawInput);
    const record = await (type === "arxiv" ? this.arxiv.fetchByArxivId(id) : this.crossref.fetchByDOI(id));
    return JSON.parse(JSON.stringify(record).replace(/<%/g, "< %"));
  }

  /** Imports a paper; returns the new note, or null when nothing was created. */
  async run(rawInput: string, options: ImportOptions = {}): Promise<NoteRef | null> {
    // ---- 1. Fetch metadata -------------------------------------------------
    let metadata: PaperMetadata;
    this.existing = null;
    try {
      this.ui.notice("Fetching metadata…", 3000);
      metadata = await this.fetch(rawInput);
    } catch (err: unknown) {
      this.ui.notice(`❌ ${formatFetchError(err)}`, 7000);
      return null;
    }
    if (options.arxivId) metadata.arxivId = detectInput(options.arxivId).id;

    // ---- 2. Duplicate check ------------------------------------------------
    if (metadata.doi) {
      const existing = this.index.doiIndex.get(normDoi(metadata.doi));
      if (existing) {
        this.ui.notice(`⚠️ This paper already exists in your vault:\n"${existing.basename}"`, 8000);
        this.ui.open(existing.basename);
        this.existing = existing;
        return null;
      }
    }
    if (metadata.arxivId) {
      const existing = this.index.arxivIndex.get(metadata.arxivId);
      if (existing) {
        this.ui.notice(`⚠️ This paper already exists in your vault:\n"${existing.basename}"`, 8000);
        this.ui.open(existing.basename);
        this.existing = existing;
        return null;
      }
    }

    const provenance = provenanceOf(metadata);
    const visibleAuthors = await this.getVisibleAuthors(metadata);
    if (visibleAuthors === null) {
      this.ui.notice("Import canceled. No article note was created.", 5000);
      return null;
    }

    // ---- 3. Resolve authors ------------------------------------------------
    const authorNames: string[] = [];
    const deferredActions: DeferredImportAction[] = [];
    for (const author of visibleAuthors) {
      const resolution = await this.resolveAuthor(author, provenance);
      if (resolution === null) {
        this.ui.notice("Import canceled. No article note was created.", 5000);
        return null;
      }
      authorNames.push(resolution.displayName);
      deferredActions.push(...resolution.actions);
    }

    // ---- 4. Resolve journal ------------------------------------------------
    let journalName: string | undefined;
    if (metadata.journalFull) {
      const resolvedJournal = await this.resolveJournal(metadata);
      if (resolvedJournal === null) {
        this.ui.notice("Import canceled. No article note was created.", 5000);
        return null;
      }
      journalName = resolvedJournal.displayName;
      deferredActions.push(...resolvedJournal.actions);
    }

    // ---- 4b. Resolve publisher (books) --------------------------------------
    let publisherName: string | undefined;
    if (metadata.itemType === "book") {
      const publisher = this.resolvePublisher(metadata.publisher);
      publisherName = publisher?.displayName;
      deferredActions.push(...(publisher?.actions ?? []));
    }

    // ---- 5. Generate bibtex ------------------------------------------------
    const bibtex = generateBibtex({
      metadata,
      journalAbbrev: this.journalAbbrev(journalName) ?? metadata.journalShort,
      takenKeys: this.index.citeKeys,
    });

    // ---- 6. Create note ----------------------------------------------------
    let file: NoteRef;
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
          publisherName,
          provenance,
          topics: options.topics,
        });
      } else {
        file = await this.creator.createArticle({
          metadata,
          bibtex,
          authorNames,
          journalName,
          provenance,
          totalAuthors: metadata.authors.length,
          topics: options.topics,
        });
      }
    } catch (err: any) {
      this.ui.notice(`❌ Could not create note: ${err.message}`, 7000);
      return null;
    }

    this.ui.notice(`✅ Imported: "${file.basename}"`, 5000);
    this.ui.open(file.basename);
    return file;
  }

  /** Abbreviation of a journal note already in the vault, used in BibTeX. */
  private journalAbbrev(journalName: string | undefined): string | undefined {
    if (!journalName) return undefined;
    const note = this.vault.resolveLink(journalName, "");
    const abbreviation = note ? this.vault.frontmatter(note.path)?.[PROP.abbreviation] : undefined;
    return typeof abbreviation === "string" && abbreviation.trim() ? abbreviation : undefined;
  }

  // --------------------------------------------------------------------------
  // Refresh: promote a preprint note to its published version
  // --------------------------------------------------------------------------

  async refreshActiveNote(file: NoteRef): Promise<void> {
    const fm = this.vault.frontmatter(file.path);
    const arxivId: string | undefined = fm?.[PROP.arxiv]
      ? String(fm[PROP.arxiv]).trim()
      : undefined;

    if (fm?.[PROP.type] !== TYPES.article || !arxivId) {
      this.ui.notice("Refresh only works on article notes with an arXiv id.", 6000);
      return;
    }

    // ---- Re-fetch metadata -------------------------------------------------
    let metadata: PaperMetadata;
    try {
      this.ui.notice("Checking for published version…", 3000);
      metadata = await this.arxiv.fetchByArxivId(arxivId);
    } catch (err: unknown) {
      this.ui.notice(`❌ ${formatFetchError(err)}`, 7000);
      return;
    }

    // ---- Detect preprint → published transition ----------------------------
    // A preprint carries the arXiv DOI (10.48550/arXiv.*) and journal "[[arXiv]]".
    // A real journal DOI from the fetch means it has now been published.
    const fetchedJournalDoi =
      !!metadata.doi && !/^10\.48550\/arxiv/i.test(metadata.doi);
    const currentDoi = fm[PROP.doi] ? String(fm[PROP.doi]) : "";
    const alreadyPublished =
      !!currentDoi && !/^10\.48550\/arxiv/i.test(currentDoi);
    if (!fetchedJournalDoi || !metadata.journalFull || alreadyPublished) {
      this.ui.notice("No publication update found — still a preprint.", 5000);
      return;
    }

    // ---- Resolve journal (create the note if missing) ----------------------
    const resolvedJournal = await this.resolveJournal(metadata);
    if (resolvedJournal === null) {
      this.ui.notice("Refresh canceled. The note was not changed.", 5000);
      return;
    }
    for (const action of resolvedJournal.actions) {
      await action();
    }

    // ---- Regenerate bibtex (@misc → @article) ------------------------------
    const bibtex = generateBibtex({
      metadata,
      journalAbbrev: this.journalAbbrev(resolvedJournal.displayName) ?? metadata.journalShort,
      citeKey: citekeyOf(fm[PROP.bibtex]),
    });

    // ---- Write back --------------------------------------------------------
    await this.vault.processFrontMatter(file.path, (fmObj) => {
      fmObj[PROP.doi] = metadata.doi ?? null;
      fmObj[PROP.journal] = `[[${resolvedJournal.displayName}]]`;
      fmObj[PROP.year] = metadata.year > 0 ? metadata.year : fmObj[PROP.year] ?? null;
      if (metadata.doi) delete fmObj[PROP.url]; // the DOI resolves; a URL would be redundant
    });
    await this.creator.writeBibtex(file, bibtex);

    this.ui.notice(`✅ Updated to published version: "${resolvedJournal.displayName}"`, 6000);
  }

  private async getVisibleAuthors(
    metadata: PaperMetadata
  ): Promise<AuthorRaw[] | null> {
    const maxAuthors = Math.max(0, this.settings.maxAuthors ?? 0);
    if (maxAuthors === 0 || metadata.authors.length <= maxAuthors) {
      return metadata.authors;
    }

    const confirmed = await this.ui.confirmOverflow(metadata.authors.length, maxAuthors, OVERFLOW_VISIBLE_AUTHORS);

    if (!confirmed) {
      return null;
    }

    return metadata.authors.slice(0, OVERFLOW_VISIBLE_AUTHORS);
  }

  // --------------------------------------------------------------------------
  // Author resolution
  // --------------------------------------------------------------------------

  private async resolveAuthor(
    author: AuthorRaw,
    provenance: Provenance
  ): Promise<PlannedEntityResolution | null> {
    const { given, family, orcid } = author;
    const match = this.index.findPerson(given, family, orcid);

    if (match.kind === "exact" && match.file) {
      return this.reuseExisting(match.file, author);
    }

    if (match.kind === "partial" && match.file) {
      const candidate = this.personFields(match.file);
      const plan = planAuthorMerge(candidate, author);

      const { choice, mergeFields } = await this.ui.disambiguate({
        entityType: "author",
        match: match.match,
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
          provenance,
        });
        return {
          displayName: plannedPerson.basename,
          actions: [async () => {
            await plannedPerson.commit();
          }],
        };
      }
    }

    const plannedPerson = this.creator.planCreatePerson({ given, family, orcid, provenance });
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

    const { choice } = await this.ui.disambiguate({
      entityType: "author (ORCID match)",
      match: "orcidSearch",
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

    // Not found — create journal note, linked to its publisher
    const publisher = this.resolvePublisher(metadata.publisher);
    const plannedJournal = this.creator.planCreateJournal({
      fullName: name,
      shortName: metadata.journalShort,
      publisherName: publisher?.displayName,
    });
    return {
      displayName: plannedJournal.basename,
      actions: [...(publisher?.actions ?? []), async () => {
        await plannedJournal.commit();
      }],
    };
  }

  /**
   * The publisher note to link, found by name or alias or to be created; none
   * without a publishers folder in the settings or a publisher in the record.
   */
  resolvePublisher(name: string | undefined): PlannedEntityResolution | undefined {
    if (!name?.trim() || !this.settings.publishersFolder) return undefined;
    const found = this.index.findPublisher(name);
    if (found) return { displayName: found.basename, actions: [] };
    const planned = this.creator.planCreatePublisher(name.trim());
    return { displayName: planned.basename, actions: [async () => { await planned.commit(); }] };
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /** Reads the Person frontmatter this plugin manages off an existing note. */
  private personFields(file: NoteRef): {
    given: string;
    family: string;
    orcid: string;
  } {
    const fm = this.vault.frontmatter(file.path);
    return {
      given: fm?.[PROP.firstName] ?? "",
      family: fm?.[PROP.lastName] ?? "",
      orcid: fm?.[PROP.orcid] ?? "",
    };
  }

  /**
   * Links to an existing Person note, filling in only the fields that note
   * leaves empty (typically a missing ORCID). Never replaces existing values —
   * that is what the explicit "merge" choice is for.
   */
  private reuseExisting(
    file: NoteRef,
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
