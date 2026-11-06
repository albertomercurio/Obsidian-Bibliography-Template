import { test } from "node:test";
import assert from "node:assert/strict";
import { allReferences, bibliography, referencesLinkedTo } from "../src/BibliographyExport";
import { NodeVault } from "../src/node/NodeHost";
import { writeVault } from "./helpers";

const entry = (key: string) => `@article{${key},\n  title = {{Test}},\n  year = 2024,\n}`;
const bibtex = (key: string) => `BibTeX: |-\n${entry(key).split("\n").map((line) => `  ${line}`).join("\n")}`;

const vaultOf = (files: Record<string, string>) => new NodeVault(writeVault(files));

const vault = vaultOf({
  "People/Mario Rossi.md": "---\nType: Person\n---\n",
  "Topics/Coupling.md": "---\nType: Topic\n---\n",
  "Projects/Grant.md": "---\nType: Project\n---\n## References\n- [[B]]\n- [[Coupling|the topic]]\n",
  "Articles/A.md": `---\nType: Article\nAuthors:\n  - "[[Mario Rossi]]"\nTopics:\n  - "[[Coupling]]"\n${bibtex("Zeta2024")}\n---\n`,
  "Articles/B.md": `---\nType: Article\n${bibtex("Alpha2024")}\n---\n`,
  "Articles/C.md": `---\nType: Article\n${bibtex("Alpha2024")}\n---\n`,
  "Articles/D.md": "---\nType: Article\nBibTeX: not an entry\n---\n",
  "Templates/Article.md": "---\nType: Article\n---\n",
});
const references = allReferences(vault, "Templates");
const note = (name: string) => vault.resolveLink(name, "")!;
const paths = (notes: { path: string }[]) => notes.map(({ path }) => path).sort();

test("all references leave out the templates", () => {
  assert.deepEqual(paths(references), ["Articles/A.md", "Articles/B.md", "Articles/C.md", "Articles/D.md"]);
});

test("the entries come out as written, sorted by key, reporting what is left out", () => {
  const { text, skipped } = bibliography(vault, references);
  assert.equal(text, `${entry("Alpha2024")}\n\n${entry("Zeta2024")}\n`);
  assert.deepEqual(skipped, [
    { path: "Articles/C.md", reason: "duplicate key Alpha2024" },
    { path: "Articles/D.md", reason: "no valid BibTeX entry" },
  ]);
});

test("references linked to a note: those it cites and those naming it", async () => {
  assert.deepEqual(paths(await referencesLinkedTo(vault, note("Grant"), references)), ["Articles/B.md"]);
  assert.deepEqual(paths(await referencesLinkedTo(vault, note("Coupling"), references)), ["Articles/A.md"]);
  assert.deepEqual(paths(await referencesLinkedTo(vault, note("Mario Rossi"), references)), ["Articles/A.md"]);
});

test("nothing to export gives an empty text", () => {
  assert.equal(bibliography(vault, []).text, "");
});
