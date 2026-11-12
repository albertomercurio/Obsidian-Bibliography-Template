import { test } from "node:test";
import assert from "node:assert/strict";
import { abstractCallout, citekeyOf, provenanceOf, setLead, setSection } from "../src/schema";
import { planAuthorMerge, mergedFields } from "../src/AuthorMerge";

test("the abstract goes in an [!abstract] callout at the top, LaTeX dollars literal", () => {
  const out = setLead("## Notes\n", abstractCallout("Energy $E = mc^2$ and $$x$$."));
  assert.equal(out, "> [!abstract]\n> Energy $E = mc^2$ and $$x$$.\n\n## Notes\n");
});

test("a template with an Abstract section gets the callout inside it", () => {
  const out = setLead("## Abstract\n\n## My Notes\n", abstractCallout("A.\n\nB."));
  assert.equal(out, "## Abstract\n\n> [!abstract]\n> A.\n> B.\n\n## My Notes\n");
});

test("setSection replaces an existing section and appends a missing one", () => {
  assert.equal(setSection("## BibTeX\n\nold\n\n## Next\n", "BibTeX", "new"), "## BibTeX\n\nnew\n\n## Next\n");
  assert.equal(setSection("text\n", "Sources", "- a"), "text\n\n## Sources\n\n- a\n");
});

test("no abstract, no callout; an empty lead leaves the body as it is", () => {
  assert.equal(abstractCallout(undefined), "");
  assert.equal(setLead("## Notes\n", ""), "## Notes\n");
  assert.equal(setLead("", "Only the first of 30 authors is linked."), "Only the first of 30 authors is linked.\n");
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
