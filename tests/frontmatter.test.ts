import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, renderNote, splitNote } from "../src/node/frontmatter";
import fixture from "./fixtures/frontmatter-style.json";

// Written as Obsidian keeps it, and read back unchanged.
fixture.cases.forEach((c, i) => {
  test(`frontmatter case ${i + 1} is written in the expected layout`, () => {
    assert.equal(renderNote(c.meta, ""), c.yaml);
  });
  test(`frontmatter case ${i + 1} reads back to the same values`, () => {
    assert.deepEqual(parseFrontmatter(splitNote(`${c.yaml}## Body\n`).yaml), c.meta);
  });
});

test("a note without frontmatter has none", () => {
  assert.deepEqual(splitNote("# Title\n"), { yaml: null, body: "# Title\n" });
});
