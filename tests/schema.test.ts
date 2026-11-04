import { test } from "node:test";
import assert from "node:assert/strict";
import { abstractCallout, citekeyOf, provenanceOf, setSection } from "../src/schema";
import { planAuthorMerge, mergedFields } from "../src/AuthorMerge";

const prov = { source: "Crossref", ident: "DOI 10.1/x", date: "2026-10-26" };
const BODY = "## Abstract\n\n## My Notes\n";

test("setSection fills an empty section and keeps LaTeX dollars literal", () => {
  const out = setSection(BODY, "Abstract", abstractCallout("Energy $E = mc^2$ and $$x$$.", prov));
  assert.match(out, /## Abstract\n\n> \[!quote\] Crossref · DOI 10\.1\/x · retrieved 2026-10-26\n> Energy \$E = mc\^2\$ and \$\$x\$\$\.\n\n## My Notes/);
});

test("setSection replaces an existing section and appends a missing one", () => {
  assert.equal(setSection("## BibTeX\n\nold\n\n## Next\n", "BibTeX", "new"), "## BibTeX\n\nnew\n\n## Next\n");
  assert.equal(setSection("text\n", "Sources", "- a"), "text\n\n## Sources\n\n- a\n");
});

test("abstract callout records the source and notes a truncated author list", () => {
  const out = abstractCallout(undefined, prov, ["Only the first of 30 authors is linked."]);
  assert.equal(out, "> [!quote] Crossref · DOI 10.1/x · retrieved 2026-10-26\n> Not provided by the source.\n>\n> Only the first of 30 authors is linked.");
});

test("provenance: journal DOIs come from Crossref, arXiv DOIs from arXiv", () => {
  assert.equal(provenanceOf({ doi: "10.1103/x" }, "d").source, "Crossref");
  assert.deepEqual(provenanceOf({ doi: "10.48550/arXiv.2207.09470", arxivId: "2207.09470" }, "d"),
    { source: "arXiv", ident: "arXiv 2207.09470", date: "d" });
});

test("citation key of an entry", () => {
  assert.equal(citekeyOf("@article{Macri2022Spontaneous,\n  year = {2022}\n}"), "Macri2022Spontaneous");
  assert.equal(citekeyOf(null), undefined);
});

test("author merge works on logical fields, independent of property names", () => {
  const plan = planAuthorMerge({ given: "A.", family: "Mercurio", orcid: "" }, { given: "Alberto", family: "Mercurio", orcid: "0000-0001-7814-1936" });
  assert.deepEqual(plan.map((f) => f.key), ["given", "family", "orcid"]);
  assert.deepEqual(mergedFields(plan), { given: "Alberto", family: "Mercurio", orcid: "0000-0001-7814-1936" });
});
