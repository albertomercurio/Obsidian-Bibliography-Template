import { test } from "node:test";
import assert from "node:assert/strict";
import {
  abstractCallout, BODIES, bibtexFromBody, bibtexSection, provenanceOf, replaceBibtexBlock, setSection,
} from "../src/schema";
import { planAuthorMerge, mergedFields } from "../src/AuthorMerge";

const prov = { source: "Crossref", ident: "DOI 10.1/x", date: "2026-10-26" };

test("setSection fills an empty section and keeps LaTeX dollars literal", () => {
  const body = BODIES.article;
  const out = setSection(body, "Abstract", abstractCallout("Energy $E = mc^2$ and $$x$$.", prov));
  assert.match(out, /## Abstract\n\n> \[!quote\] Crossref · retrieved 2026-10-26\n> Energy \$E = mc\^2\$ and \$\$x\$\$\.\n\n## My Notes/);
});

test("setSection replaces an existing section and appends a missing one", () => {
  const once = setSection("## BibTeX\n\nold\n\n## Next\n", "BibTeX", "new");
  assert.equal(once, "## BibTeX\n\nnew\n\n## Next\n");
  assert.equal(setSection("text\n", "Sources", "- a"), "text\n\n## Sources\n\n- a\n");
});

test("bibtex section matches the format sb checks (verified source line)", () => {
  const section = bibtexSection("@article{K,\n  title = {{T}},\n}", prov, ["Only the first of 30 authors is linked."]);
  assert.equal(
    section,
    "> [!info] Source: Crossref · DOI 10.1/x · retrieved 2026-10-26\n> Only the first of 30 authors is linked.\n\n```bibtex\n@article{K,\n  title = {{T}},\n}\n```"
  );
  assert.equal(bibtexFromBody(`## BibTeX\n\n${section}\n`), "@article{K,\n  title = {{T}},\n}");
});

test("provenance: journal DOIs come from Crossref, arXiv DOIs from arXiv", () => {
  assert.equal(provenanceOf({ doi: "10.1103/x" }, "d").source, "Crossref");
  assert.deepEqual(provenanceOf({ doi: "10.48550/arXiv.2207.09470", arxivId: "2207.09470" }, "d"),
    { source: "arXiv", ident: "arXiv 2207.09470", date: "d" });
});

test("regenerating keeps the source line and replaces only the entry", () => {
  const body = `## BibTeX\n\n${bibtexSection("@article{K,\n  year = 2020,\n}", prov)}\n`;
  const out = replaceBibtexBlock(body, "@article{K,\n  year = 2021,\n}");
  assert.match(out, /Source: Crossref · DOI 10\.1\/x · retrieved 2026-10-26/);
  assert.match(out, /year = 2021/);
  assert.doesNotMatch(out, /year = 2020/);
});

test("author merge works on logical fields, independent of property names", () => {
  const plan = planAuthorMerge({ given: "A.", family: "Mercurio", orcid: "" }, { given: "Alberto", family: "Mercurio", orcid: "0000-0001-7814-1936" });
  assert.deepEqual(plan.map((f) => f.key), ["given", "family", "orcid"]);
  assert.deepEqual(mergedFields(plan), { given: "Alberto", family: "Mercurio", orcid: "0000-0001-7814-1936" });
});
