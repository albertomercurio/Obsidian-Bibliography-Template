// ---------------------------------------------------------------------------
// The commands of Obsidian's command line, `research-importer:<name>`: what
// they do and the text they print, for people and agents. Commands that write
// show a preview and write only with `apply`; they answer the questions of an
// import without asking (AutoUi), unless told which authors are the same person
// (`same`) or to ask in the plugin's windows (`ask`); with `apply` they add what
// they wrote to the log note of the settings, when there is one. main.ts
// registers them; the tests run them in Node.
// ---------------------------------------------------------------------------

import { addFiles, linkedFiles, makeCover } from "./Attachments";
import { AutoUi } from "./AutoUi";
import { allReferences, bibliography, referencesLinkedTo } from "./BibliographyExport";
import { ImportService } from "./ImportService";
import { NoteCreator } from "./NoteCreator";
import { identifierOf } from "./PdfFiles";
import type { Http, NoteRef, PdfPort, Ui, VaultPort } from "./ports";
import { ReferenceCheck } from "./ReferenceCheck";
import { lintReferences, lintReport } from "./ReferenceLint";
import { citekeyOf, localDate, PROP, provenanceOf } from "./schema";
import { type Change, StagedVault, type YamlCodec } from "./StagedVault";
import type { PluginSettings } from "./types";
import { VaultIndex } from "./VaultIndex";

export interface CommandHost {
  vault: VaultPort;
  http: Http;
  settings: PluginSettings;
  yaml: YamlCodec;
  /** Reads PDFs: their identifier and Figure 1, for `add pdf=` and covers. Obsidian has one. */
  pdf?: PdfPort;
  /** Pause between two records fetched from the public APIs, in milliseconds (default 200). */
  pause?: number;
}

/** A note named as a wikilink would (`file`) or by its exact path (`path`). */
export interface NoteQuery {
  file?: string;
  path?: string;
}

function session(host: CommandHost, apply: boolean, say: (line: string) => void, ui = new AutoUi(say, apply)) {
  // ORCID name search asks questions only a person can answer: only when they are asked.
  const settings: PluginSettings = { ...host.settings, skipOrcidSearch: ui.asks ? host.settings.skipOrcidSearch : true };
  const vault = new StagedVault(host.vault, host.yaml, apply);
  const index = new VaultIndex(vault, settings.templatesFolder);
  index.build();
  const creator = new NoteCreator(vault, settings, ui, index);
  const importer = new ImportService(vault, ui, host.http, settings, index, creator);
  const checker = new ReferenceCheck(vault, settings, index, creator, importer);
  return { settings, vault, ui, importer, checker };
}

/** The note a query names, null when it names none; an error when that note does not exist. */
export function findNote(vault: VaultPort, query: NoteQuery): NoteRef | null {
  if (query.path) {
    const path = query.path.replace(/^\/+/, "");
    const found = vault.markdownFiles().find((note) => note.path === path || note.path === `${path}.md`);
    if (!found) throw new Error(`No note at ${query.path}`);
    return found;
  }
  if (query.file) {
    const found = vault.resolveLink(query.file.replace(/\.md$/i, ""), "");
    if (!found) throw new Error(`No note named "${query.file}"`);
    return found;
  }
  return null;
}

const label = (change: Change) => `${change.action === "create" ? "created" : "updated"}: ${change.path}`;

/** Adds an entry to the log note of the settings, if any: `## [date] kind | title` and a line per detail. */
async function log(host: CommandHost, kind: string, title: string, details: string[]): Promise<void> {
  const path = host.settings.logFile?.trim();
  if (!path) return;
  const entry = `\n## [${localDate()}] ${kind} | ${title}\n${details.map((detail) => `- ${detail}\n`).join("")}`;
  if (host.vault.exists(path)) {
    await host.vault.process(path, (text) => text + entry);
  } else {
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (folder) await host.vault.ensureFolder(folder);
    await host.vault.create(path, entry.trimStart());
  }
}

export interface AddOptions {
  /** DOI or arXiv id; without it, the one printed in `pdf`. */
  id?: string;
  /** A PDF of the paper in the vault: moved to the PDF folder, named after the citation key, and linked. */
  pdf?: string;
  /** Also make a cover from Figure 1 of the PDF. */
  cover?: boolean;
  /** Names of topic notes to link; each must exist. */
  topics?: string[];
  /** arXiv id of the preprint, when `id` is the DOI of the published version. */
  arxiv?: string;
  /** Authors that are the person already in the vault, named as the preview names them. */
  same?: string[];
  /** Asks the questions of the import instead of answering them: the plugin's windows. */
  ask?: Ui;
  apply: boolean;
}

export async function addCommand(host: CommandHost, options: AddOptions): Promise<string> {
  const out: string[] = [];
  const say = (...lines: string[]) => out.push(...lines);
  const { settings, vault, ui, importer } = session(host, options.apply, say, new AutoUi(say, options.apply, { same: options.same, ask: options.ask }));
  const topics = (options.topics ?? []).map((name) => {
    const note = vault.resolveLink(name, "");
    if (!note) throw new Error(`No note named "${name}" to link as a topic`);
    return note.basename;
  });
  const pdf = options.pdf?.replace(/^\/+/, "");
  if (pdf && !vault.exists(pdf)) throw new Error(`No file at ${pdf}`);
  if (options.cover && !pdf) throw new Error("cover cuts Figure 1 from a PDF: give it with pdf=");
  let id = options.id;
  if (!id) {
    if (!pdf) throw new Error("name the paper: id=<DOI|arXiv>, or pdf=<file> to read it there");
    if (!host.pdf) throw new Error("reading a PDF needs Obsidian: name the paper with id=");
    id = identifierOf(await host.pdf.pages(pdf, 2));
    say(`${pdf}: ${id}`);
  }
  const file = await importer.run(id, { topics, arxivId: options.arxiv });
  for (const decision of ui.decisions) say(`  · ${decision}`);
  for (const name of ui.unusedSame) say(`  ! same="${name}": no question about this author; name them as the preview does, before the colon`);
  const note = file ?? importer.existing;
  let moves: string[] = [];
  let trashed = false;
  let duplicate = false;
  if (note && pdf) ({ moves, trashed, duplicate } = await addFiles(vault, host.pdf, settings, { note, created: Boolean(file), pdf, cover: options.cover }, say));
  if (!file && !vault.changes.length && !moves.length && !duplicate) return out.join("\n");
  for (const change of vault.changes) say(`${options.apply ? "+" : "?"} ${change.path}  (${change.action})`);
  say(...moves);
  if (!options.apply) {
    say("", "Preview: nothing written. Run again with apply to write the notes.");
    return out.join("\n");
  }
  const fm = vault.frontmatter(note!.path) ?? {};
  const source = provenanceOf({ doi: fm[PROP.doi] ?? undefined, arxivId: fm[PROP.arxiv] ?? undefined });
  await log(host, file ? "lit-add" : "lit-files", `${citekeyOf(fm[PROP.bibtex]) ?? note!.basename} — ${fm[PROP.title]}`, [
    `source: ${source.source} ${source.ident}`,
    ...ui.decisions,
    ...vault.changes.map(label),
    ...moves.map((line) => line.replace(/^\+ /, "moved: ").replace(/\s+\(move\)$/, "")),
    ...(trashed ? [`trashed: ${pdf}, the same file as the PDF the note links`] : []),
  ]);
  const files = vault.changes.filter((change) => !change.path.toLowerCase().endsWith(".md")).length;
  say("", files ? `${vault.changes.length - files} notes and ${files} files written.` : `${vault.changes.length} notes written.`);
  return out.join("\n");
}

export interface CoverOptions {
  /** One reference; without it, every reference with a PDF and no cover. */
  note?: NoteQuery;
  apply: boolean;
}

/** Covers from Figure 1 of the first PDF of references that have none. */
export async function coverCommand(host: CommandHost, options: CoverOptions): Promise<string> {
  const out: string[] = [];
  const say = (...lines: string[]) => out.push(...lines);
  const { settings, vault } = session(host, options.apply, say);
  const property = settings.coverProperty.trim();
  if (!property) throw new Error("covers need a cover property in the settings");
  const target = findNote(host.vault, options.note ?? {});
  const notes = target
    ? [target]
    : allReferences(vault, settings.templatesFolder).filter((note) => !vault.frontmatter(note.path)?.[property] && linkedFiles(vault, note, PROP.pdf).length);
  let made = 0;
  for (const note of notes) {
    const [pdf] = linkedFiles(vault, note, PROP.pdf);
    if (!pdf) {
      if (target) say(`  ! ${note.basename}: no PDF linked`);
      continue;
    }
    say(note.path);
    if (await makeCover(vault, host.pdf, settings, note, { now: pdf, final: pdf }, say)) made++;
  }
  for (const change of vault.changes) say(`${options.apply ? "+" : "?"} ${change.path}  (${change.action})`);
  if (!made) {
    say(notes.length ? "No cover made." : "Every reference with a PDF has a cover.");
    return out.join("\n");
  }
  if (!options.apply) {
    say("", `Preview: ${made} covers, nothing written. Run again with apply to write them.`);
    return out.join("\n");
  }
  await log(host, "lit-cover", `${made} covers from Figure 1`, vault.changes.map(label));
  say("", `${made} covers written.`);
  return out.join("\n");
}

export interface CheckOptions {
  /** One reference; without it, all of them. */
  note?: NoteQuery;
  /** Add what notes are missing, where the record is surely the same work. */
  repair?: boolean;
  /** Make the note say what the source says: one named note at a time. */
  restore?: boolean;
  apply: boolean;
}

export async function checkCommand(host: CommandHost, options: CheckOptions): Promise<string> {
  if (options.repair && options.restore) throw new Error("choose repair (add what is missing) or restore (overwrite with the source)");
  const target = findNote(host.vault, options.note ?? {});
  if (options.restore && !target) throw new Error("restore overwrites what a note says: name it with file= or path=, one note at a time");
  const out: string[] = [];
  const say = (...lines: string[]) => out.push(...lines);
  const { settings, vault, checker } = session(host, options.apply, say);
  const notes = target ? [target] : allReferences(vault, settings.templatesFolder);
  const pause = host.pause ?? 200;
  let different = 0;
  const changed: string[] = [];
  for (const [i, note] of notes.entries()) {
    if (i > 0 && pause > 0) await new Promise((resolve) => setTimeout(resolve, pause)); // courtesy towards the public APIs
    const result = await checker.check(note);
    if (!result.issues.length) continue;
    different++;
    const change = options.restore ? result.restore : options.repair ? result.complete : undefined;
    say(`${change ? "+" : "!"} ${note.path}`);
    for (const issue of result.issues) say(`    ${issue}`);
    if (options.restore) for (const created of result.creates) say(`    create: ${created}`);
    if (change) {
      await change();
      changed.push(note.path);
    }
  }
  if (!different) {
    say(`${notes.length} references checked: all match their source.`);
    return out.join("\n");
  }
  say("", `${notes.length} references checked, ${different} with differences.`);
  if (changed.length && !options.apply) say("Preview: nothing written. Run again with apply to write.");
  if (changed.length && options.apply) {
    const how = options.restore ? "restored from" : "completed from";
    await log(host, "lit-check", `${changed.length} references ${how} their source`, vault.changes.map(label));
    say(`${changed.length} references ${how} their source.`);
  }
  return out.join("\n");
}

/** The BibTeX of all references, or of those linked to a note; what is left out comes first, as comments. */
export async function exportCommand(host: CommandHost, options: { note?: NoteQuery } = {}): Promise<string> {
  const all = allReferences(host.vault, host.settings.templatesFolder);
  const target = findNote(host.vault, options.note ?? {});
  const { text, skipped } = bibliography(host.vault, target ? await referencesLinkedTo(host.vault, target, all) : all);
  const comments = skipped.map(({ path, reason }) => `% Left out ${path}: ${reason}`);
  if (!text) comments.push("% No BibTeX entries.");
  return [...comments, ...(comments.length && text ? [""] : []), text.trimEnd()].join("\n").trimEnd();
}

export async function lintCommand(host: CommandHost, options: { all?: boolean; json?: boolean } = {}): Promise<string> {
  const result = await lintReferences(host.vault, host.settings);
  return options.json ? JSON.stringify(result.issues, null, 1) : lintReport(result, Boolean(options.all));
}
