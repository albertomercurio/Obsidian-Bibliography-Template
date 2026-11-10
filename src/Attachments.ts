// ---------------------------------------------------------------------------
// Files of a reference: its PDF, moved next to the others and named after the
// citation key, and its cover, Figure 1 cut from the PDF. Both write through
// the vault of the run, so a preview plans them and `apply` does them.
// ---------------------------------------------------------------------------

import { figureOne } from "./PdfFiles";
import type { NoteRef, PdfPort } from "./ports";
import { citekeyOf, PROP } from "./schema";
import type { StagedVault } from "./StagedVault";
import type { PluginSettings } from "./types";

const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);

/** The values of a property that may hold one link or a list of them. */
function linksIn(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
}

const target = (link: string) => link.replace(/^\[\[|\]\]$/g, "").split("|")[0].split("#")[0].trim();

/** The files a property of the note links, as paths; links to nothing are left out. */
export function linkedFiles(vault: StagedVault, note: NoteRef, property: string): string[] {
  const fm = vault.frontmatter(note.path) ?? {};
  return linksIn(fm[property])
    .map((link) => vault.resolveLink(target(link), note.path)?.path)
    .filter((path): path is string => Boolean(path));
}

function keyOf(vault: StagedVault, note: NoteRef): string {
  return citekeyOf(vault.frontmatter(note.path)?.[PROP.bibtex]) ?? note.basename;
}

/** `<folder>/<name><ext>`, or with -2, -3… when that is taken by another file. */
function freePath(vault: StagedVault, folder: string, name: string, ext: string, self?: string): string {
  let path = join(folder, `${name}${ext}`);
  for (let i = 2; vault.exists(path) && path !== self; i++) path = join(folder, `${name}-${i}${ext}`);
  return path;
}

export async function sameBytes(vault: StagedVault, a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([vault.readBinary(a), vault.readBinary(b)]);
  if (x.byteLength !== y.byteLength) return false;
  const [u, v] = [new Uint8Array(x), new Uint8Array(y)];
  for (let i = 0; i < u.length; i++) if (u[i] !== v[i]) return false;
  return true;
}

/**
 * Moves the PDF to the PDF folder of the settings (or leaves it in its own),
 * named after the citation key, and adds it to the note's PDF property.
 * Returns where the PDF is, or will be after `apply`.
 */
export async function attachPdf(vault: StagedVault, settings: PluginSettings, note: NoteRef, pdf: string, say: (line: string) => void): Promise<string> {
  const folder = settings.pdfFolder.trim().replace(/\/+$/, "") || folderOf(pdf);
  let path = freePath(vault, folder, keyOf(vault, note), ".pdf", pdf);
  if (path !== pdf) {
    await vault.ensureFolder(folder);
    const moved = await vault.rename(pdf, path);
    if (vault.apply && !moved) {
      say(`! ${pdf}: this host cannot move files; linked where it is`);
      path = pdf;
    } else {
      say(`${vault.apply ? "+" : "?"} ${pdf} → ${path}  (move)`);
    }
  }
  const link = `[[${nameOf(path)}]]`;
  await vault.processFrontMatter(note.path, (fm) => {
    const links = linksIn(fm[PROP.pdf]);
    if (!links.includes(link)) fm[PROP.pdf] = [...links, link];
  });
  return path;
}

/**
 * Cuts Figure 1 of the PDF into `<citation key>-cover.png` next to where the
 * PDF goes, and links it from the cover property of the settings. Says why
 * when there is no cover to make.
 */
export async function makeCover(
  vault: StagedVault,
  pdfPort: PdfPort | undefined,
  settings: PluginSettings,
  note: NoteRef,
  pdf: { now: string; final: string },
  say: (line: string) => void
): Promise<boolean> {
  const property = settings.coverProperty.trim();
  if (!property) throw new Error("covers need a cover property in the settings");
  if (!pdfPort) throw new Error("covers need a PDF reader: run the command in Obsidian");
  const existing = vault.frontmatter(note.path)?.[property];
  if (existing) {
    say(`  · ${note.basename} has a cover already: ${existing}`);
    return false;
  }
  const found = figureOne(await pdfPort.pages(pdf.now, 6));
  if (!found) {
    say(`  ! ${pdf.now}: no caption of Figure 1 with a picture above it in the first pages; no cover`);
    return false;
  }
  let png: ArrayBuffer;
  try {
    png = await pdfPort.png(pdf.now, found.page, found.box, 1200);
  } catch (err) {
    say(`  ! ${pdf.now}: ${err instanceof Error ? err.message : err}; no cover`);
    return false;
  }
  const path = freePath(vault, folderOf(pdf.final), `${keyOf(vault, note)}-cover`, ".png");
  await vault.createBinary(path, png);
  await vault.processFrontMatter(note.path, (fm) => {
    fm[property] = `[[${nameOf(path)}]]`;
  });
  say(`  · cover: Figure 1, page ${found.page} of the PDF`);
  return true;
}
