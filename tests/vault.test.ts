// Checks of a real vault, run only with VAULT=<vault folder>: the offline check
// finds no errors in its references, and their BibTeX exports. Nothing is
// written. For CI, where Obsidian is not available: the author's vault runs
// them on GitHub at every push.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { exportCommand } from "../src/CommandLine";
import { NodeVault } from "../src/node/NodeHost";
import { nodeYaml } from "../src/node/frontmatter";
import { lintReferences } from "../src/ReferenceLint";
import { DEFAULT_SETTINGS, type PluginSettings } from "../src/types";

const root = process.env.VAULT;
const skip = root ? false : "set VAULT=<vault folder> to check a vault";

function settings(): PluginSettings {
  const file = join(root!, ".obsidian/plugins/research-importer/data.json");
  return { ...DEFAULT_SETTINGS, ...(existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}) };
}

test("the references of the vault have no errors in the offline check", { skip }, async () => {
  const { issues } = await lintReferences(new NodeVault(root!), settings());
  const errors = issues.filter((issue) => issue.severity === "error");
  assert.deepEqual(errors.map((issue) => `${issue.code} ${issue.path}:${issue.line} ${issue.message}`), []);
});

test("the BibTeX of the vault exports", { skip }, async () => {
  const vault = new NodeVault(root!);
  const text = await exportCommand({ vault, http: async () => ({ status: 0, text: "", json: null }), settings: settings(), yaml: nodeYaml });
  assert.ok(text.startsWith("@") || text.startsWith("%"), text.slice(0, 200));
});
