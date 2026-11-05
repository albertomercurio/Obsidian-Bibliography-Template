import { test } from "node:test";
import assert from "node:assert/strict";
import { sameFamilyName, sameGivenNames } from "../src/nameUtils";
import { signatureDiff, withFields } from "../src/ReferenceCheck";

test("given names: initials, hyphens, accents and names left out", () => {
  for (const [a, b] of [["J. M.", "Jay Michael"], ["Jay", "Jay M."], ["Y.-T.", "Yi-Te"], ["Félix", "Felix"], ["A.", "Alexandre"], ["Anton Frisk", "Anton"], ["", "Anything"]]) {
    assert.ok(sameGivenNames(a, b), `${a} / ${b}`);
    assert.ok(sameGivenNames(b, a), `${b} / ${a}`);
  }
  for (const [a, b] of [["Mario", "Salvatore"], ["J.", "Mario"], ["Jay M.", "Jay R."]]) assert.ok(!sameGivenNames(a, b), `${a} / ${b}`);
});

test("family names: compound surnames kept in part by a source", () => {
  for (const [a, b] of [["Frisk Kockum", "Kockum"], ["Lo Franco", "Franco"], ["Sánchez Muñoz", "Munoz"], ["Macrì", "Macri"]]) assert.ok(sameFamilyName(a, b), `${a} / ${b}`);
  for (const [a, b] of [["Kockum", "Rossi"], ["Eli", "Li"], ["", "Rossi"]]) assert.ok(!sameFamilyName(a, b), `${a} / ${b}`);
});

test("entry comparison tells what is missing from what differs, and accepts compound surnames", () => {
  const entry = (extra: string, author = "Frisk Kockum, Anton") => `@article{K,\n  author = {${author}},\n  title = {{T}},\n  year = {2019}${extra}\n}`;
  assert.deepEqual(signatureDiff(entry(""), entry(",\n  pages = {12}", "Kockum, Anton Frisk")), { missing: ["pages"], different: [] });
  assert.deepEqual(signatureDiff(entry(",\n  pages = {13}"), entry(",\n  pages = {12}")), { missing: [], different: ["pages"] });
  assert.deepEqual(signatureDiff(entry(""), entry("", "Rossi, Anton")), { missing: [], different: ["author"] });
  assert.deepEqual(signatureDiff(undefined, entry("")), { missing: ["entry"], different: [] });
});

test("new fields go before the closing brace; the rest stays as written", () => {
  assert.equal(withFields("@article{K,\n  year = 2019\n}", { pages: "12" }), "@article{K,\n  year = 2019,\n  pages = {12}\n}");
  assert.equal(withFields("@article{K,\n  year = 2019,\n}\n", { pages: "12" }), "@article{K,\n  year = 2019,\n  pages = {12}\n}");
});
