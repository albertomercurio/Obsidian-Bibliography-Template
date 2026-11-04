// ---------------------------------------------------------------------------
// BibTeX export: the entries exactly as the notes hold them, sorted by key.
// ---------------------------------------------------------------------------

import type { NoteRef, VaultPort } from "./ports";
import { citekeyOf, PROP, TYPES } from "./schema";

const WIKILINK = /\[\[([^\]|#\n]+)/g;
const linksIn = (text: string) => [...text.matchAll(WIKILINK)].map((match) => match[1].trim());

/** Articles and books of the vault, without the templates. */
export function allReferences(vault: VaultPort, templatesFolder: string): NoteRef[] {
  return vault.markdownFiles().filter(({ path }) => {
    const type = vault.frontmatter(path)?.[PROP.type];
    return (type === TYPES.article || type === TYPES.book) && !path.startsWith(`${templatesFolder}/`);
  });
}

/** The references a note cites, and those naming it in a property (as author, topic or journal). */
export async function referencesLinkedTo(vault: VaultPort, note: NoteRef, references: NoteRef[]): Promise<NoteRef[]> {
  const cited = new Set(linksIn(await vault.read(note.path)).map((link) => vault.resolveLink(link, note.path)?.path));
  return references.filter(({ path }) => {
    const properties = JSON.stringify(vault.frontmatter(path) ?? {});
    return cited.has(path) || linksIn(properties).some((link) => vault.resolveLink(link, path)?.path === note.path);
  });
}

export interface Bibliography {
  text: string;
  skipped: { path: string; reason: string }[];
}

export function bibliography(vault: VaultPort, notes: NoteRef[]): Bibliography {
  const entries = new Map<string, string>();
  const skipped: Bibliography["skipped"] = [];
  for (const { path } of [...notes].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const entry = vault.frontmatter(path)?.[PROP.bibtex];
    const key = citekeyOf(entry);
    if (!key) skipped.push({ path, reason: "no valid BibTeX entry" });
    else if (entries.has(key)) skipped.push({ path, reason: `duplicate key ${key}` });
    else entries.set(key, entry.trim());
  }
  const sorted = [...entries.keys()].sort().map((key) => entries.get(key));
  return { text: sorted.length ? `${sorted.join("\n\n")}\n` : "", skipped };
}
