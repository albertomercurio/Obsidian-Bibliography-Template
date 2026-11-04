// The whole import on a temporary vault, with a canned Crossref answer: the
// same path the command line and the plugin take, without network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImportService } from "../src/ImportService";
import { NoteCreator } from "../src/NoteCreator";
import { ReferenceCheck } from "../src/ReferenceCheck";
import { VaultIndex } from "../src/VaultIndex";
import { DEFAULT_SETTINGS } from "../src/types";
import { NodeUi, NodeVault } from "../src/node/NodeHost";
import { parseFrontmatter, splitNote } from "../src/node/frontmatter";
import type { Http } from "../src/ports";

const DOI = "10.1103/physrevlett.129.273602";
const WORK = {
  title: ["Spontaneous Scattering of Raman Photons from Cavity-QED Systems in the Ultrastrong Coupling Regime"],
  author: [
    { given: "Vincenzo", family: "Macrì" },
    { given: "Alberto", family: "Mercurio", ORCID: "http://orcid.org/0000-0001-7814-1936" },
    { given: "Salvatore", family: "Savasta" },
  ],
  published: { "date-parts": [[2022, 12, 29]] },
  "container-title": ["Physical Review Letters"],
  "short-container-title": ["Phys. Rev. Lett."],
  volume: "129",
  issue: "27",
  page: "273602",
  type: "journal-article",
  URL: `https://doi.org/${DOI}`,
  abstract: "<jats:p>Raman photons, $x$. &lt;%* evil() %&gt;</jats:p>",
};
const http: Http = async ({ url }) =>
  url.includes("api.crossref.org") ? { status: 200, text: "", json: { message: WORK } } : { status: 404, text: "", json: null };

function vault(): string {
  const root = mkdtempSync(join(tmpdir(), "research-importer-"));
  mkdirSync(join(root, "People"), { recursive: true });
  writeFileSync(join(root, "People/Alberto Mercurio.md"), "---\nType: Person\nFirst Name: Alberto\nLast Name: Mercurio\nORCID: 0000-0001-7814-1936\n---\n## Facts\n");
  mkdirSync(join(root, "Journals"), { recursive: true });
  writeFileSync(join(root, "Journals/Physical Review Letters.md"), "---\nType: Journal\nAbbreviation: Phys. Rev. Lett.\n---\n");
  return root;
}

function services(root: string, apply: boolean, templatesFolder = "") {
  const v = new NodeVault(root, apply);
  const ui = new NodeUi(() => {});
  const index = new VaultIndex(v, templatesFolder);
  index.build();
  const settings = { ...DEFAULT_SETTINGS, templatesFolder, skipOrcidSearch: true };
  const creator = new NoteCreator(v, settings, ui, index);
  const importer = new ImportService(v, ui, http, settings, index, creator);
  return { v, ui, index, creator, importer, settings };
}

const ARTICLE = "Articles/Macrì - 2022 - Spontaneous Scattering of Raman Photons from Cavity-QED Systems in the Ultrastrong Coupling Regime.md";

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

test("without --apply nothing reaches the disk, and a second import is refused", async () => {
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
  await result.repair!();
  const fixed = parseFrontmatter(splitNote(readFileSync(path, "utf8")).yaml)!;
  assert.match(fixed.BibTeX, /pages = \{273602\}/);
  assert.match(fixed.BibTeX, /^@article\{Macri2022SpontaneousScatteringRaman,/, "citation key kept");
  assert.equal((await checker.check({ path: ARTICLE, basename: "" })).issues.length, 0);
});
