// The whole import on a temporary vault, with a canned Crossref answer: the
// same path the plugin and its command line take, without network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ImportService } from "../src/ImportService";
import { NoteCreator } from "../src/NoteCreator";
import { ReferenceCheck } from "../src/ReferenceCheck";
import { VaultIndex } from "../src/VaultIndex";
import { DEFAULT_SETTINGS } from "../src/types";
import { AutoUi } from "../src/AutoUi";
import { NodeVault } from "../src/node/NodeHost";
import { nodeYaml, parseFrontmatter, splitNote } from "../src/node/frontmatter";
import { StagedVault } from "../src/StagedVault";
import { ARTICLE, DOI, http, sampleVault as vault } from "./helpers";

function services(root: string, apply: boolean, templatesFolder = "") {
  const v = new StagedVault(new NodeVault(root), nodeYaml, apply);
  const ui = new AutoUi(() => {}, apply);
  const index = new VaultIndex(v, templatesFolder);
  index.build();
  const settings = { ...DEFAULT_SETTINGS, templatesFolder, skipOrcidSearch: true };
  const creator = new NoteCreator(v, settings, ui, index);
  const importer = new ImportService(v, ui, http, settings, index, creator);
  return { v, ui, index, creator, importer, settings };
}


test("import writes article, new authors and BibTeX property in order, without any setup", async () => {
  const root = vault();
  const { importer } = services(root, true);
  const file = await importer.run(DOI, { arxivId: "2207.09470" });
  assert.equal(file?.path, ARTICLE);
  const text = readFileSync(join(root, ARTICLE), "utf8");
  const fm = parseFrontmatter(splitNote(text).yaml)!;
  assert.deepEqual(Object.keys(fm), ["Type", "Title", "Authors", "Journal", "Year", "DOI", "arXiv", "PDF", "Read", "Topics", "BibTeX"]);
  assert.deepEqual(fm.Authors, ["[[Vincenzo Macrì]]", "[[Alberto Mercurio]]", "[[Salvatore Savasta]]"]);
  assert.match(text, /Raman photons, \$x\$\. < %\* evil\(\) %>/, "external text cannot run as a Templater command");
  assert.doesNotMatch(text, /<%/);
  assert.equal(fm.Journal, "[[Physical Review Letters]]");
  assert.equal(fm.Read, false);
  assert.match(fm.BibTeX, /^@article\{Macri2022SpontaneousScatteringRaman,\n/);
  assert.match(fm.BibTeX, /journal = \{Phys\. Rev\. Lett\.\}/);
  assert.match(text, /\nBibTeX: \|-\n  @article\{/);
  assert.match(text, /> \[!quote\] Crossref · DOI 10\.1103\/physrevlett\.129\.273602 · retrieved/);
  assert.doesNotMatch(text, /## BibTeX/);
  const person = parseFrontmatter(splitNote(readFileSync(join(root, "People/Vincenzo Macrì.md"), "utf8")).yaml)!;
  assert.deepEqual(Object.keys(person), ["Type", "First Name", "Last Name", "ORCID", "Email", "Affiliations", "Relationship"]);
  assert.deepEqual(person.Relationship, ["Author"]);
  assert.match(readFileSync(join(root, "People/Vincenzo Macrì.md"), "utf8"), /## Sources\n\n- Created on .+ from the Crossref record/);
});

test("a template file sets properties, their order and the body; templates are not indexed", async () => {
  const root = vault();
  mkdirSync(join(root, "Templates"));
  writeFileSync(join(root, "Templates/Article.md"), "---\nType: Article\nYear:\nTitle:\nAuthors:\nExtra:\nBibTeX:\n---\n## Abstract\n\n## My Section\n");
  writeFileSync(join(root, "Templates/Journal.md"), "---\nType: Journal\nAbbreviation:\n---\n## Links\n");
  const { importer, index } = services(root, true, "Templates");
  assert.equal(index.findJournal("Journal").kind, "none");
  await importer.run(DOI);
  const text = readFileSync(join(root, ARTICLE), "utf8");
  const fm = parseFrontmatter(splitNote(text).yaml)!;
  assert.deepEqual(Object.keys(fm).slice(0, 6), ["Type", "Year", "Title", "Authors", "Extra", "BibTeX"]);
  assert.equal(fm.Extra, null);
  assert.match(text, /## Abstract\n\n> \[!quote\][\s\S]*## My Section/);
});

test("without apply nothing reaches the disk, and a second import is refused", async () => {
  const root = vault();
  const dry = services(root, false);
  assert.ok(await dry.importer.run(DOI));
  assert.ok(dry.v.changes.length >= 3);
  assert.equal(existsSync(join(root, ARTICLE)), false);
  const real = services(root, true);
  await real.importer.run(DOI);
  assert.equal(await services(root, true).importer.run(DOI), null, "already in the vault");
});

test("reference check sees a changed page and restores it", async () => {
  const root = vault();
  await services(root, true).importer.run(DOI);
  const path = join(root, ARTICLE);
  writeFileSync(path, readFileSync(path, "utf8").replace("pages = {273602}", "pages = {273603}").replace("Title: Spontaneous", "Title: Spontaneus"));
  const s = services(root, true);
  const checker = new ReferenceCheck(s.v, s.settings, s.index, s.creator, s.importer);
  const result = await checker.check({ path: ARTICLE, basename: "" });
  assert.ok(result.issues.some((i) => i.startsWith("Title:")));
  assert.ok(result.issues.some((i) => i.includes("pages")));
  await result.restore!();
  const fixed = parseFrontmatter(splitNote(readFileSync(path, "utf8")).yaml)!;
  assert.match(fixed.BibTeX, /pages = \{273602\}/);
  assert.match(fixed.BibTeX, /^@article\{Macri2022SpontaneousScatteringRaman,/, "citation key kept");
  assert.equal((await checker.check({ path: ARTICLE, basename: "" })).issues.length, 0);
});

function checkerFor(root: string) {
  const s = services(root, true);
  return new ReferenceCheck(s.v, s.settings, s.index, s.creator, s.importer);
}

test("completing adds only what is missing: disagreeing authors stay, no notes are created", async () => {
  const root = vault();
  await services(root, true).importer.run(DOI);
  const path = join(root, ARTICLE);
  writeFileSync(join(root, "People/Mario Rossi.md"), "---\nType: Person\nFirst Name: Mario\nLast Name: Rossi\n---\n");
  writeFileSync(path, readFileSync(path, "utf8").replace(/,?\n\s*pages = \{273602\}/, "").replace('"[[Salvatore Savasta]]"', '"[[Mario Rossi]]"'));
  const result = await checkerFor(root).check({ path: ARTICLE, basename: "" });
  assert.deepEqual(result.missing, ["add to BibTeX: pages"]);
  assert.ok(result.conflicts.some((i) => i.startsWith("Authors:")));
  const people = readdirSync(join(root, "People")).length;
  await result.complete!();
  const fm = parseFrontmatter(splitNote(readFileSync(path, "utf8")).yaml)!;
  assert.match(fm.BibTeX, /pages = \{273602\}\n\}$/);
  assert.ok(fm.Authors.includes("[[Mario Rossi]]"), "what the note says is kept");
  assert.equal(readdirSync(join(root, "People")).length, people);
});

for (const [what, from, to] of [["title", "Title: Spontaneous", "Title: Proceedings"], ["year", "Year: 2022", "Year: 2021"]]) {
  test(`nothing is added when the ${what} disagrees: the record may be another work`, async () => {
    const root = vault();
    await services(root, true).importer.run(DOI);
    const path = join(root, ARTICLE);
    writeFileSync(path, readFileSync(path, "utf8").replace(/,?\n\s*pages = \{273602\}/, "").replace(from, to));
    const result = await checkerFor(root).check({ path: ARTICLE, basename: "" });
    assert.equal(result.complete, undefined);
    assert.ok(result.restore, "it can still be restored, one note at a time");
  });
}

test("authors already linked stay linked when the source writes their name another way", async () => {
  const root = vault();
  await services(root, true).importer.run(DOI);
  const path = join(root, ARTICLE);
  writeFileSync(join(root, "People/S. Savasta.md"), "---\nType: Person\nFirst Name: S.\nLast Name: Savasta\n---\n");
  writeFileSync(join(root, "People/V. Frisk Macrì.md"), "---\nType: Person\nFirst Name: V.\nLast Name: Frisk Macrì\n---\n");
  writeFileSync(path, readFileSync(path, "utf8").replace('"[[Salvatore Savasta]]"', '"[[S. Savasta]]"').replace('"[[Vincenzo Macrì]]"', '"[[V. Frisk Macrì]]"'));
  const result = await checkerFor(root).check({ path: ARTICLE, basename: "" });
  assert.deepEqual(result.creates, []);
  assert.deepEqual(result.issues, []);
});

test("an author with another name is not taken for the one linked", async () => {
  const root = vault();
  await services(root, true).importer.run(DOI);
  const path = join(root, ARTICLE);
  writeFileSync(join(root, "People/Mario Savasta.md"), "---\nType: Person\nFirst Name: Mario\nLast Name: Savasta\n---\n");
  writeFileSync(path, readFileSync(path, "utf8").replace('"[[Salvatore Savasta]]"', '"[[Mario Savasta]]"'));
  const result = await checkerFor(root).check({ path: ARTICLE, basename: "" });
  assert.ok(result.conflicts.some((i) => i.startsWith("Authors:")));
});
