// ---------------------------------------------------------------------------
// Command line of the plugin: the same code, run by Node on the files of a
// vault, for scripts and agents. Commands show their plan and write only with
// --apply. Settings come from the plugin's data.json in the vault.
//
//   node cli.mjs add <DOI|arXiv> [--topic Name]... [--arxiv ID] [--apply]
//   node cli.mjs check [note]... [--repair] [--apply]
//   node cli.mjs export [note]        BibTeX on standard output, nothing written
//
// Options: --vault DIR (default: current folder), --log FILE (append a log entry).
// ---------------------------------------------------------------------------

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { allReferences, bibliography, referencesLinkedTo } from "./src/BibliographyExport";
import { ImportService } from "./src/ImportService";
import { NoteCreator } from "./src/NoteCreator";
import { ReferenceCheck } from "./src/ReferenceCheck";
import { VaultIndex } from "./src/VaultIndex";
import type { NoteRef } from "./src/ports";
import { citekeyOf, localDate, PROP, provenanceOf } from "./src/schema";
import { DEFAULT_SETTINGS, type PluginSettings } from "./src/types";
import { NodeUi, NodeVault, nodeHttp } from "./src/node/NodeHost";

const USAGE = `usage:
  add <DOI|arXiv> [--topic Name]... [--arxiv ID] [--apply]   import a paper
  check [note]... [--repair] [--apply]                       compare references with their source
  export [note]                                              print the BibTeX of all references, or of those linked to a note`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    vault: { type: "string", default: process.cwd() },
    log: { type: "string" },
    apply: { type: "boolean", default: false },
    repair: { type: "boolean", default: false },
    topic: { type: "string", multiple: true, default: [] },
    arxiv: { type: "string" },
  },
});

const root = values.vault!;
const say = (line: string) => console.log(line);
const today = () => process.env.SB_TODAY || localDate();
const label = (action: string) => (action === "create" ? "created" : "updated");

function log(kind: string, title: string, details: string[]): void {
  if (!values.log) return;
  const lines = [`\n## [${today()}] ${kind} | ${title}\n`, ...details.map((d) => `- ${d}\n`)];
  appendFileSync(join(root, values.log), lines.join(""), "utf8");
}

function setup() {
  const dataFile = join(root, ".obsidian/plugins/research-importer/data.json");
  const saved = existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, "utf8")) : {};
  const settings: PluginSettings = { ...DEFAULT_SETTINGS, ...saved, skipOrcidSearch: true };
  const vault = new NodeVault(root, values.apply!);
  const ui = new NodeUi(say, values.apply!);
  const index = new VaultIndex(vault, settings.templatesFolder);
  index.build();
  const creator = new NoteCreator(vault, settings, ui, index);
  const importer = new ImportService(vault, ui, nodeHttp, settings, index, creator);
  return { settings, vault, ui, index, creator, importer };
}

async function add(identifier: string): Promise<number> {
  const { vault, ui, importer } = setup();
  const topics = values.topic!.map((name) => {
    const note = vault.resolveLink(name, "");
    if (!note) throw new Error(`No such note: ${name}`);
    return note.basename;
  });
  const file = await importer.run(identifier, { topics, arxivId: values.arxiv });
  for (const decision of ui.decisions) say(`  · ${decision}`);
  if (!file) return 1;
  for (const change of vault.changes) {
    say(`${values.apply ? "+" : "?"} ${change.path}  (${change.action === "create" ? "create" : "update"})`);
  }
  if (!values.apply) {
    say("\nPreview: nothing written. Run again with --apply to create the notes.");
    return 0;
  }
  const fm = vault.frontmatter(file.path) ?? {};
  const prov = provenanceOf({ doi: fm[PROP.doi] ?? undefined, arxivId: fm[PROP.arxiv] ?? undefined }, today());
  log("lit-add", `${citekeyOf(fm[PROP.bibtex]) ?? file.basename} — ${fm[PROP.title]}`, [
    `source: ${prov.source} ${prov.ident}`,
    ...ui.decisions,
    ...vault.changes.map((c) => `${label(c.action)}: ${c.path}`),
  ]);
  say(`\n${vault.changes.length} notes written.`);
  return 0;
}

function findNote(vault: NodeVault, name: string): NoteRef {
  const found = vault.resolveLink(name.replace(/\.md$/i, ""), "");
  if (!found) throw new Error(`No note found for "${name}".`);
  return found;
}

async function exportBibtex(name?: string): Promise<number> {
  const { settings, vault } = setup();
  const all = allReferences(vault, settings.templatesFolder);
  const { text, skipped } = bibliography(vault, name ? await referencesLinkedTo(vault, findNote(vault, name), all) : all);
  for (const { path, reason } of skipped) console.error(`left out ${path}: ${reason}`);
  process.stdout.write(text);
  return 0;
}

async function check(names: string[]): Promise<number> {
  const { settings, vault, index, creator, importer } = setup();
  const checker = new ReferenceCheck(vault, settings, index, creator, importer);
  const notes = names.length ? names.map((name) => findNote(vault, name)) : allReferences(vault, settings.templatesFolder);
  let problems = 0;
  const repaired: string[] = [];
  for (const note of notes) {
    const result = await checker.check(note);
    await new Promise((resolve) => setTimeout(resolve, 200)); // courtesy towards the public APIs
    if (!result.issues.length) continue;
    problems++;
    say(`${values.repair && result.repair ? "+" : "!"} ${note.path}`);
    for (const issue of result.issues) say(`    ${issue}`);
    for (const created of result.creates) say(`    create: ${created}`);
    if (values.repair && result.repair) {
      await result.repair();
      repaired.push(note.path);
    }
  }
  if (!problems) {
    say(`${notes.length} references checked: all match their source.`);
    return 0;
  }
  say(`\n${notes.length} references checked, ${problems} with differences.`);
  if (values.repair && !values.apply) say("Preview: nothing written. Run again with --repair --apply to restore from the source.");
  if (values.repair && values.apply && repaired.length) {
    log("lit-check", `${repaired.length} references restored from their source`, vault.changes.map((c) => `${label(c.action)}: ${c.path}`));
  }
  return 1;
}

async function main(): Promise<number> {
  const [command, ...rest] = positionals;
  if (command === "add" && rest.length === 1) return add(rest[0]);
  if (command === "check") return check(rest);
  if (command === "export" && rest.length <= 1) return exportBibtex(rest[0]);
  say(USAGE);
  return 2;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
);
