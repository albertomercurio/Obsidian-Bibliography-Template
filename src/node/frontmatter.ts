// Frontmatter on plain files, for the Node host: read and written as Obsidian
// does, with the same YAML library and the same layout.

import { parse, stringify } from "yaml";
import type { Frontmatter } from "../ports";
import { splitNote } from "../schema";
import type { YamlCodec } from "../StagedVault";

export { splitNote };

export function parseFrontmatter(yamlText: string | null): Frontmatter | undefined {
  if (yamlText === null) return undefined;
  const data = parse(yamlText);
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

const stringifyFrontmatter = (fm: Frontmatter) => stringify(fm, { lineWidth: 0, nullStr: "", aliasDuplicateObjects: false });

/** Note text from frontmatter and body. */
export function renderNote(fm: Frontmatter, body: string): string {
  const yaml = Object.keys(fm).length ? stringifyFrontmatter(fm) : "";
  return `---\n${yaml}---\n${body.replace(/^\n+/, "")}`;
}

export const nodeYaml: YamlCodec = { parse, stringify: stringifyFrontmatter };
