// The commands of Obsidian's command line, run in Node on a temporary vault:
// what they print, and that they write only with apply.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addCommand, checkCommand, type CommandHost, exportCommand, lintCommand } from "../src/CommandLine";
import { NodeVault } from "../src/node/NodeHost";
import { nodeYaml, parseFrontmatter, splitNote } from "../src/node/frontmatter";
import { DEFAULT_SETTINGS } from "../src/types";
import { ARTICLE, DOI, http, sampleVault, writeVault } from "./helpers";

const host = (root: string, logFile = "system/log.md"): CommandHost => ({
  vault: new NodeVault(root),
  http,
  settings: { ...DEFAULT_SETTINGS, logFile },
  yaml: nodeYaml,
  pause: 0,
});

const files = (root: string, folder: string) => (existsSync(join(root, folder)) ? readdirSync(join(root, folder)).sort() : []);

test("add shows its plan and writes nothing; with apply it writes and logs", async () => {
  const root = sampleVault();
  writeFileSync(join(root, "Coupling.md"), "---\nType: Topic\n---\n");
  const preview = await addCommand(host(root), { id: DOI, topics: ["coupling"], apply: false });
  assert.match(preview, /^Would import: "Macrì - 2022 - /m);
  assert.match(preview, new RegExp(`^\\? ${ARTICLE}  \\(create\\)$`, "m"));
  assert.match(preview, /^\? People\/Vincenzo Macrì\.md {2}\(create\)$/m);
  assert.match(preview, /Preview: nothing written\. Run again with apply to write the notes\.$/);
  assert.deepEqual(files(root, "Articles"), []);
  assert.equal(existsSync(join(root, "system/log.md")), false);

  const applied = await addCommand(host(root), { id: DOI, topics: ["Coupling"], apply: true });
  assert.match(applied, new RegExp(`^\\+ ${ARTICLE}  \\(create\\)$`, "m"));
  assert.match(applied, /notes written\.$/);
  const fm = parseFrontmatter(splitNote(readFileSync(join(root, ARTICLE), "utf8")).yaml)!;
  assert.deepEqual(fm.Topics, ["[[Coupling]]"]);
  const log = readFileSync(join(root, "system/log.md"), "utf8");
  assert.match(log, /^## \[\d{4}-\d{2}-\d{2}\] lit-add \| Macri2022SpontaneousScatteringRaman — Spontaneous Scattering/);
  assert.match(log, /\n- source: Crossref DOI 10\.1103\/physrevlett\.129\.273602\n/);
  assert.match(log, new RegExp(`\\n- created: ${ARTICLE}\\n`));

  const again = await addCommand(host(root), { id: DOI, apply: true });
  assert.match(again, /already exists in your vault/);
  assert.equal(readFileSync(join(root, "system/log.md"), "utf8"), log, "nothing logged when nothing is written");
});

test("add refuses a topic that is not a note", async () => {
  await assert.rejects(addCommand(host(sampleVault()), { id: DOI, topics: ["Nowhere"], apply: false }), /No note named "Nowhere" to link as a topic/);
});

test("check lists differences; repair previews, then adds what is missing with apply", async () => {
  const root = sampleVault();
  await addCommand(host(root, ""), { id: DOI, apply: true });
  const path = join(root, ARTICLE);
  writeFileSync(path, readFileSync(path, "utf8").replace(/,?\n\s*pages = \{273602\}/, ""));
  const written = readFileSync(path, "utf8");

  const listed = await checkCommand(host(root), { apply: true });
  assert.match(listed, new RegExp(`^! ${ARTICLE}\\n {4}add to BibTeX: pages$`, "m"));
  assert.match(listed, /1 references checked, 1 with differences\.$/);
  assert.equal(readFileSync(path, "utf8"), written, "without repair nothing is written, even with apply");

  const preview = await checkCommand(host(root), { note: { file: ARTICLE.split("/")[1] }, repair: true, apply: false });
  assert.match(preview, new RegExp(`^\\+ ${ARTICLE}$`, "m"));
  assert.match(preview, /Preview: nothing written\. Run again with apply to write\.$/);
  assert.equal(readFileSync(path, "utf8"), written);

  const repaired = await checkCommand(host(root), { repair: true, apply: true });
  assert.match(repaired, /1 references completed from their source\.$/);
  assert.match(readFileSync(path, "utf8"), /pages = \{273602\}/);
  assert.match(readFileSync(join(root, "system/log.md"), "utf8"), new RegExp(`lit-check \\| 1 references completed from their source\\n- updated: ${ARTICLE}\\n`));
  assert.match(await checkCommand(host(root), { apply: false }), /^1 references checked: all match their source\.$/);
});

test("restore names one note, and cannot be combined with repair", async () => {
  const root = sampleVault();
  await assert.rejects(checkCommand(host(root), { restore: true, apply: false }), /restore overwrites what a note says: name it/);
  await assert.rejects(checkCommand(host(root), { repair: true, restore: true, apply: false }), /choose repair/);
  await assert.rejects(checkCommand(host(root), { note: { path: "Articles/None.md" }, apply: false }), /No note at Articles\/None\.md/);
});

test("export prints the entries, with what it leaves out as comments", async () => {
  const entry = (key: string) => `BibTeX: |-\n  @article{${key},\n    title = {T}\n  }`;
  const root = writeVault({
    "Projects/Grant.md": "---\nType: Project\n---\n- [[A]]\n",
    "Articles/A.md": `---\nType: Article\n${entry("Alpha2024")}\n---\n`,
    "Articles/B.md": `---\nType: Article\n${entry("Beta2024")}\n---\n`,
    "Articles/C.md": "---\nType: Article\nBibTeX: not an entry\n---\n",
  });
  assert.equal(
    await exportCommand(host(root)),
    "% Left out Articles/C.md: no valid BibTeX entry\n\n@article{Alpha2024,\n  title = {T}\n}\n\n@article{Beta2024,\n  title = {T}\n}"
  );
  assert.equal(await exportCommand(host(root), { note: { path: "Projects/Grant" } }), "@article{Alpha2024,\n  title = {T}\n}");
  assert.equal(await exportCommand(host(root), { note: { file: "B" } }), "% No BibTeX entries.");
});

test("lint prints the offline check as text or JSON", async () => {
  const root = writeVault({ "Articles/A.md": "---\nType: Article\nTitle: A\nDOI: 10.1/a\nBibTeX: |-\n  @article{A,\n    doi = {10.1/b}\n  }\n---\n" });
  assert.match(await lintCommand(host(root)), /^error {3}bibtex-mismatch {4}Articles\/A\.md:4 {2}DOI in the BibTeX \(10\.1\/b\) differs from the property \(10\.1\/a\)/);
  const json = JSON.parse(await lintCommand(host(root), { json: true }));
  assert.deepEqual(json.map((issue: { code: string }) => issue.code), ["bibtex-mismatch"]);
});
