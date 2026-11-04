import { test } from "node:test";
import assert from "node:assert/strict";
import { generateBibtex } from "../src/BibtexGenerator";
import { signatureDiff } from "../src/ReferenceCheck";
import { bibtexFields } from "../src/schema";
import expected from "./fixtures/citation-keys-expected.json";
import type { PaperMetadata } from "../src/types";

for (const name of ["prl2022", "quantum2025"] as const) {
  const fixture = expected[name];
  const metadata = fixture.metadata as PaperMetadata;

  test(`${name}: stable citation key and fields`, () => {
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

test("a taken citation key gets a letter; a kept key never changes", () => {
  const metadata = expected.prl2022.metadata as PaperMetadata;
  const taken = new Set([expected.prl2022.citekey]);
  assert.match(generateBibtex({ metadata, takenKeys: taken }), new RegExp(`^@article\\{${expected.prl2022.citekey}a,`));
  assert.match(generateBibtex({ metadata, takenKeys: taken, citeKey: "Mine" }), /^@article\{Mine,/);
});

test("signature diff ignores layout and sees content", () => {
  const metadata = expected.prl2022.metadata as PaperMetadata;
  const canonical = generateBibtex({ metadata, journalAbbrev: metadata.journalShort });
  const relaid = canonical.replace("{Spontaneous", "{{S}pontaneous").replace(/  /g, "    ");
  assert.deepEqual(signatureDiff(relaid, canonical), { missing: [], different: [] });
  assert.deepEqual(signatureDiff(canonical.replace("273602", "273603"), canonical).different, ["pages"]);
  assert.deepEqual(signatureDiff(canonical.replace("Nori, Franco and ", ""), canonical).different, ["author"]);
});
