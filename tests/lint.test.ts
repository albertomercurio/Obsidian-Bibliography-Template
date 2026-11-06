// The offline check: each reference against its own BibTeX, and the references
// against each other, on a temporary vault.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NodeVault } from "../src/node/NodeHost";
import { renderNote } from "../src/node/frontmatter";
import type { Frontmatter } from "../src/ports";
import { lintReferences, lintReport } from "../src/ReferenceLint";
import { DEFAULT_SETTINGS } from "../src/types";
import { writeVault } from "./helpers";

const entry = (key: string, fields: Record<string, string>) =>
  `@article{${key},\n${Object.entries(fields).map(([name, value]) => `  ${name} = {${value}}`).join(",\n")}\n}`;

const FIELDS = {
  author: "Macr\\`{i}, Vincenzo and Kockum, Anton Frisk",
  title: "Spontaneous Scattering of {R}aman Photons in the $\\mathrm{USC}$ Regime",
  journal: "Phys. Rev. Lett.",
  year: "2022",
  doi: "10.1103/physrevlett.129.273602",
  eprint: "2207.09470",
};

const GOOD: Frontmatter = {
  Type: "Article",
  Title: "Spontaneous Scattering of Raman Photons in the USC Regime",
  Authors: ["[[Vincenzo Macrì]]", "[[Anton Frisk Kockum]]"],
  Journal: "[[Physical Review Letters]]",
  Year: 2022,
  DOI: "https://doi.org/10.1103/PhysRevLett.129.273602",
  arXiv: "2207.09470",
  BibTeX: entry("Macri2022", FIELDS),
};

const article = (changes: Frontmatter, body = "## Notes\n") => renderNote({ ...GOOD, ...changes }, body);

const BASE = {
  "People/Vincenzo Macrì.md": "---\nType: Person\nFirst Name: Vincenzo\nLast Name: Macrì\n---\n",
  "People/Anton Frisk Kockum.md": "---\nType: Person\nFirst Name: Anton\nLast Name: Frisk Kockum\n---\n",
  "Journals/Physical Review Letters.md": "---\nType: Journal\nAbbreviation: Phys. Rev. Lett.\nAliases:\n  - PRL\n---\n",
  "Templates/Article.md": "---\nType: Article\nTitle:\nBibTeX:\n---\n",
};

async function lint(files: Record<string, string>, maxAuthors = 25) {
  const vault = new NodeVault(writeVault({ ...BASE, ...files }));
  return lintReferences(vault, { ...DEFAULT_SETTINGS, templatesFolder: "Templates", maxAuthors });
}

const summary = (issues: { severity: string; code: string; path: string }[]) => issues.map(({ severity, code, path }) => `${severity} ${code} ${path}`);

test("a note that agrees with its BibTeX has no problems, whatever the layout of the entry", async () => {
  const good = await lint({ "Articles/Good.md": article({}) });
  assert.equal(good.checked, 1, "templates are not references");
  assert.deepEqual(summary(good.issues), []);
  const title = "Spontaneous Scattering of\n    {R}aman Photons in the\n    $\\mathrm{USC}$ Regime";
  const oneLine = `@article{Macri2022, author = {${FIELDS.author}}, title = {${title}}, journal = "Phys. Rev. Lett.", year = 2022, doi = {${FIELDS.doi}}, eprint = {2207.09470}}`;
  assert.deepEqual(summary((await lint({ "Articles/Good.md": article({ BibTeX: oneLine }) })).issues), []);
});

test("BibTeX missing, unreadable, or in the body", async () => {
  const { issues } = await lint({
    "Articles/Missing.md": article({ Title: "Missing", BibTeX: null, DOI: "10.1/a", arXiv: null }),
    "Articles/Invalid.md": article({ Title: "Invalid", BibTeX: "title = {No header}", DOI: "10.1/b", arXiv: null }),
    "Articles/Body.md": article({ Title: "Body", BibTeX: null, DOI: "10.1/c", arXiv: null }, "## Notes\n\nText\n\n```bibtex\n@article{X,\n}\n```\n"),
  });
  assert.deepEqual(summary(issues), [
    "error bibtex-invalid Articles/Invalid.md",
    "warning bibtex-in-body Articles/Body.md",
    "info bibtex-missing Articles/Body.md",
    "info bibtex-missing Articles/Missing.md",
  ]);
  const body = issues.find((issue) => issue.code === "bibtex-in-body")!;
  assert.equal(body.line, 17, "the line of the fence");
  assert.equal(issues.find((issue) => issue.code === "bibtex-invalid")!.line, 11, "the line of the property");
  assert.match(issues.find((issue) => issue.path === "Articles/Missing.md")!.hint, /research-importer:check file="Missing" repair/);
});

test("DOI and year must agree with the entry", async () => {
  const { issues } = await lint({ "Articles/Good.md": article({ DOI: "10.1103/PhysRevLett.129.000000", Year: 2021 }) });
  assert.deepEqual(issues.map(({ severity, code, message }) => `${severity} ${code} ${message}`), [
    "error bibtex-mismatch DOI in the BibTeX (10.1103/physrevlett.129.273602) differs from the property (10.1103/PhysRevLett.129.000000)",
    "warning bibtex-mismatch year in the BibTeX (2022) differs from the property (2021)",
  ]);
});

test("title, arXiv id, authors and journal must agree with the entry", async () => {
  const { issues } = await lint({
    "People/Mario Rossi.md": "---\nType: Person\nFirst Name: Mario\nLast Name: Rossi\n---\n",
    "Journals/Nature.md": "---\nType: Journal\n---\n",
    "Articles/Good.md": article({
      Title: "Another Title",
      arXiv: "2207.09471",
      Authors: ["[[Vincenzo Macrì]]", "[[Mario Rossi]]"],
      Journal: "[[Nature]]",
    }),
  });
  assert.deepEqual(issues.map(({ code, line, message }) => `${code} ${line} ${message}`), [
    "reference-mismatch 3 Title differs from the title in the BibTeX",
    "reference-mismatch 4 Authors (2) do not match the authors in the BibTeX (2 expected)",
    "reference-mismatch 7 journal in the BibTeX (Phys. Rev. Lett.) differs from [[Nature]]",
    "reference-mismatch 10 arXiv 2207.09471 differs from eprint 2207.09470 in the BibTeX",
  ]);
  assert.match(issues[0].hint, /Check the active reference, or research-importer:check file="Good"/);
});

test("journal by alias, an arXiv id read as a number, and only the first author over the limit", async () => {
  const alias = await lint({ "Articles/Good.md": article({ BibTeX: entry("Macri2022", { ...FIELDS, journal: "PRL" }) }) });
  assert.deepEqual(summary(alias.issues), []);
  const number = await lint({ "Articles/Good.md": article({ BibTeX: entry("Macri2022", { ...FIELDS, eprint: "2207.0947" }) }).replace(/^arXiv: .*$/m, "arXiv: 2207.0947") });
  assert.deepEqual(summary(number.issues), []);

  const many = Array.from({ length: 30 }, (_, i) => `Author${i}, A.`).join(" and ");
  const large = article({ Authors: ["[[A. Author0]]"], BibTeX: entry("Macri2022", { ...FIELDS, author: many }) });
  const files = { "People/A. Author0.md": "---\nType: Person\nLast Name: Author0\n---\n", "Articles/Large.md": large };
  assert.deepEqual(summary((await lint(files)).issues), []);
  assert.deepEqual(summary((await lint(files, 0)).issues), ["warning reference-mismatch Articles/Large.md"], "0 means no limit: every author is expected");
});

test("the same work twice: DOI, arXiv id or citation key; the same title unless linked", async () => {
  const { issues } = await lint({
    "Articles/A.md": article({}),
    "Articles/B.md": article({ DOI: "10.1103/physrevlett.129.273602", arXiv: null, Title: "Other", BibTeX: entry("Other2022", { ...FIELDS, title: "Other", eprint: "" }) }),
    "Articles/C.md": article({ DOI: "10.1/c", arXiv: null, Title: "Third", BibTeX: entry("MACRI2022", { ...FIELDS, doi: "10.1/c", title: "Third", eprint: "" }) }),
    "Articles/D.md": article({ DOI: "10.1/d", arXiv: null, BibTeX: entry("D2022", { ...FIELDS, doi: "10.1/d", eprint: "" }) }),
    "Articles/E.md": article({ DOI: "10.1/e", arXiv: null, "Version Of": "[[A]]", BibTeX: entry("E2022", { ...FIELDS, doi: "10.1/e", eprint: "" }) }),
    "Articles/F.md": article({ DOI: "10.1/f", arXiv: null, BibTeX: entry("F2022", { ...FIELDS, doi: "10.1/f", eprint: "" }) }),
    "Articles/G.md": article({ DOI: "10.1/g", arXiv: null, Related: ["[[F]]"], BibTeX: entry("G2022", { ...FIELDS, doi: "10.1/g", eprint: "" }) }),
    "Books/H.md": renderNote({ Type: "Book", Title: GOOD.Title, BibTeX: "@book{H2022,\n  title = {Spontaneous Scattering of Raman Photons in the USC Regime}\n}" }, ""),
  });
  assert.deepEqual(issues.map(({ severity, code, path, message }) => `${severity} ${code} ${path} ${message}`), [
    "error article-duplicate Articles/B.md DOI 10.1103/physrevlett.129.273602 is also in Articles/A.md",
    "error article-duplicate Articles/C.md citation key MACRI2022 is also in Articles/A.md",
    "warning article-duplicate Articles/D.md same title as Articles/A.md",
  ]);
});

test("the report lists errors and warnings, and the notices on request", async () => {
  const result = await lint({ "Articles/Missing.md": article({ BibTeX: null }), "Articles/Bad.md": article({ Title: "Bad", DOI: "10.1/x", arXiv: null, BibTeX: "nothing" }) });
  assert.equal(
    lintReport(result, false),
    'error   bibtex-invalid     Articles/Bad.md:11  BibTeX entry header not recognised → compare it with the source: Check the active reference, or research-importer:check file="Bad"\n\n' +
      "2 references: 1 errors, 0 warnings, 1 notices (all: list the notices too)"
  );
  assert.match(lintReport(result, true), /info {4}bibtex-missing {5}Articles\/Missing\.md:11 {2}no BibTeX: left out of exports/);
});
