import { test } from "node:test";
import assert from "node:assert/strict";
import { generateBibtex } from "../src/BibtexGenerator";
import { bibtexFields } from "../src/schema";
import expected from "./fixtures/second-brain-expected.json";
import type { PaperMetadata } from "../src/types";

for (const name of ["prl2022", "quantum2025"] as const) {
  const fixture = expected[name];
  const metadata = fixture.metadata as PaperMetadata;

  test(`${name}: same citation key and fields as sb lit add`, () => {
    const entry = generateBibtex({ metadata, journalAbbrev: metadata.journalShort });
    assert.match(entry, new RegExp(`^@article\\{${fixture.citekey},`));
    const fields = bibtexFields(entry);
    assert.equal(fields.author, fixture.author);
    assert.equal(fields.journal, fixture.journal);
    assert.equal(fields.eprint, fixture.eprint);
    assert.equal(fields.url, undefined, "no url when a DOI is present");
  });
}

test("url kept when there is no DOI", () => {
  const metadata = { ...(expected.prl2022.metadata as PaperMetadata), doi: undefined, url: "https://example.org/p" };
  assert.equal(bibtexFields(generateBibtex({ metadata })).url, "https://example.org/p");
});

test("authorField override keeps a full author list", () => {
  const metadata = expected.prl2022.metadata as PaperMetadata;
  const entry = generateBibtex({ metadata: { ...metadata, authors: metadata.authors.slice(0, 1) }, authorField: "A, B and C, D and E, F" });
  assert.equal(bibtexFields(entry).author, "A, B and C, D and E, F");
});
