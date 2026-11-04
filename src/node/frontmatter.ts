// Frontmatter on plain files, for the command line: read and written as Obsidian
// does, with the same YAML library and the same layout.

import { parse, stringify } from "yaml";
import type { Frontmatter } from "../ports";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Splits a note into its YAML text (null when absent) and body. */
export function splitNote(text: string): { yaml: string | null; body: string } {
  const m = text.match(FRONTMATTER_RE);
  if (!m) return { yaml: null, body: text };
  return { yaml: m[1], body: text.slice(m[0].length) };
}

export function parseFrontmatter(yamlText: string | null): Frontmatter | undefined {
  if (yamlText === null) return undefined;
  const data = parse(yamlText);
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

/** Note text from frontmatter and body. */
export function renderNote(fm: Frontmatter, body: string): string {
  const yaml = Object.keys(fm).length ? stringify(fm, { lineWidth: 0, nullStr: "", aliasDuplicateObjects: false }) : "";
  return `---\n${yaml}---\n${body.replace(/^\n+/, "")}`;
}
