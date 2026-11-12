// ---------------------------------------------------------------------------
// Files of a reference: its PDF, moved next to the others and named after the
// citation key, and its cover, Figure 1 cut from the PDF. Both write through
// the vault of the run, so a preview plans them and `apply` does them.
// ---------------------------------------------------------------------------

import { figureOne } from "./PdfFiles";
import type { NoteRef, PdfPage, PdfPort, VaultPort } from "./ports";
import { citekeyOf, PROP } from "./schema";
import type { PluginSettings } from "./types";

/** The vault of a run: a preview plans, `apply` writes (StagedVault). */
type Files = VaultPort & { readonly apply: boolean };

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
export function linkedFiles(vault: Files, note: NoteRef, property: string): string[] {
  const fm = vault.frontmatter(note.path) ?? {};
  return linksIn(fm[property])
    .map((link) => vault.resolveLink(target(link), note.path)?.path)
    .filter((path): path is string => Boolean(path));
}

function keyOf(vault: Files, note: NoteRef): string {
  return citekeyOf(vault.frontmatter(note.path)?.[PROP.bibtex]) ?? note.basename;
}

/** `<folder>/<name><ext>`, or with -2, -3… when that is taken by another file (or planned in this run). */
function freePath(vault: Files, folder: string, name: string, ext: string, self?: string, taken = new Set<string>()): string {
  const used = (path: string) => (vault.exists(path) || taken.has(path)) && path !== self;
  let path = join(folder, `${name}${ext}`);
  for (let i = 2; used(path); i++) path = join(folder, `${name}-${i}${ext}`);
  return path;
}

/** Two downloads of one PDF can differ in a few bytes (a date, an id) and not in their text. */
async function sameText(pdfPort: PdfPort, a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([pdfPort.pages(a, 2000), pdfPort.pages(b, 2000)]);
  const text = (page: PdfPage) => page.items.map((item) => item.str).join("");
  return x.length === y.length && x.every((page, i) => text(page) === text(y[i]));
}

export async function sameBytes(vault: Files, a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([vault.readBinary(a), vault.readBinary(b)]);
  if (x.byteLength !== y.byteLength) return false;
  const [u, v] = [new Uint8Array(x), new Uint8Array(y)];
  for (let i = 0; i < u.length; i++) if (u[i] !== v[i]) return false;
  return true;
}

/** `<folder>/<name>-n<ext>`, the first n from 2 that no other file takes (or is planned in this run). */
function nextPath(vault: Files, folder: string, name: string, ext: string, self?: string, taken = new Set<string>()): string {
  const used = (path: string) => (vault.exists(path) || taken.has(path)) && path !== self;
  let path = join(folder, `${name}-2${ext}`);
  for (let i = 3; used(path); i++) path = join(folder, `${name}-${i}${ext}`);
  return path;
}

/**
 * Moves the PDF to the PDF folder of the settings (or leaves it in its own),
 * named after the citation key, and adds it to the note's PDF property. The
 * main PDF, the first one, is `<citation key>.pdf`; the others follow as
 * `<citation key>-2.pdf`, `-3.pdf`… Returns where the PDF is, or will be
 * after `apply`.
 */
export async function attachPdf(
  vault: Files,
  settings: PluginSettings,
  note: NoteRef,
  pdf: string,
  say: (line: string) => void,
  main: boolean,
  taken = new Set<string>()
): Promise<string> {
  const folder = settings.pdfFolder.trim().replace(/\/+$/, "") || folderOf(pdf);
  const key = keyOf(vault, note);
  let path = main ? freePath(vault, folder, key, ".pdf", pdf, taken) : nextPath(vault, folder, key, ".pdf", pdf, taken);
  taken.add(path);
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
  vault: Files,
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
  await vault.writeBinary(path, png);
  await vault.processFrontMatter(note.path, (fm) => {
    fm[property] = `[[${nameOf(path)}]]`;
  });
  say(`  · cover: Figure 1, page ${found.page} of the PDF`);
  return true;
}

export interface FilesResult {
  /** A PDF was a copy of one the note links. */
  duplicate: boolean;
  trashed: boolean;
  /** "? a → b  (move)" lines, for the output. */
  moves: string[];
}

/**
 * Places one PDF of the note: a copy of a PDF it links (byte for byte, or
 * another download with the same text) goes to the trash; any other is moved
 * and linked, as the main PDF when the note has none yet, else as the next.
 * Returns where the PDF is now and after `apply`.
 */
async function placePdf(
  vault: Files,
  pdfPort: PdfPort | undefined,
  settings: PluginSettings,
  note: NoteRef,
  pdf: string,
  placed: number,
  taken: Set<string>,
  result: FilesResult,
  say: (line: string) => void
): Promise<{ now: string; final: string }> {
  const pdfs = linkedFiles(vault, note, PROP.pdf);
  if (pdfs.includes(pdf)) {
    say(`  · the note links ${pdf} already`);
    return { now: pdf, final: pdf };
  }
  let same: string | undefined;
  let how = "the same file as";
  for (const path of pdfs) if (await sameBytes(vault, path, pdf)) same = path;
  if (!same && pdfPort) {
    for (const path of pdfs) if (await sameText(pdfPort, path, pdf)) [same, how] = [path, "another download of"];
  }
  if (same) {
    say(`  · ${pdf} is ${how} ${same}, which the note links`);
    result.duplicate = true;
    const trashed = await vault.trash(pdf);
    result.trashed ||= trashed;
    say(trashed ? `  - ${pdf}: moved to the trash` : `  · with apply, ${pdf} goes to the trash`);
    return { now: same, final: same };
  }
  // In a preview the PDFs placed before are not files yet: they count too.
  const main = pdfs.length === 0 && placed === 0;
  const final = await attachPdf(vault, settings, note, pdf, (line) => result.moves.push(line), main, taken);
  // With apply the PDF has moved already; a preview finds it where it was.
  return { now: vault.apply ? final : pdf, final };
}

/**
 * After an import: the PDFs of the paper, the first the main one when the note
 * has none, and, if asked, a cover from Figure 1 of the main PDF.
 */
export async function addFiles(
  vault: Files,
  pdfPort: PdfPort | undefined,
  settings: PluginSettings,
  options: { note: NoteRef; pdfs?: string[]; cover?: boolean },
  say: (line: string) => void
): Promise<FilesResult> {
  const { note } = options;
  const result: FilesResult = { duplicate: false, trashed: false, moves: [] };
  const hadPdf = linkedFiles(vault, note, PROP.pdf)[0];
  const placed: { now: string; final: string }[] = [];
  const taken = new Set<string>();
  for (const pdf of options.pdfs ?? []) placed.push(await placePdf(vault, pdfPort, settings, note, pdf, placed.length, taken, result, say));
  if (options.cover) {
    const main = hadPdf ? { now: hadPdf, final: hadPdf } : placed[0];
    if (main) await makeCover(vault, pdfPort, settings, note, main, say);
    else say("  ! no PDF to cut a cover from");
  }
  return result;
}

/** An image for a cover: its bytes and extension (png, jpg…). */
export interface CoverImage {
  data: ArrayBuffer;
  ext: string;
}

/**
 * Makes an image the note's cover: `<citation key>-cover.<ext>` next to its
 * PDF (or in the PDF folder), replacing a cover of that name; a cover with
 * another name goes to the trash. Returns the path of the cover.
 */
export async function saveCover(vault: Files, settings: PluginSettings, note: NoteRef, image: CoverImage, say: (line: string) => void): Promise<string> {
  const property = settings.coverProperty.trim();
  if (!property) throw new Error("covers need a cover property in the settings");
  const [pdf] = linkedFiles(vault, note, PROP.pdf);
  const folder = pdf ? folderOf(pdf) : settings.pdfFolder.trim().replace(/\/+$/, "") || folderOf(note.path);
  const path = join(folder, `${keyOf(vault, note)}-cover.${image.ext}`);
  const [old] = linkedFiles(vault, note, property);
  if (folder) await vault.ensureFolder(folder);
  await vault.writeBinary(path, image.data);
  await vault.processFrontMatter(note.path, (fm) => {
    fm[property] = `[[${nameOf(path)}]]`;
  });
  if (old && old !== path) say((await vault.trash(old)) ? `  - ${old}: the old cover, moved to the trash` : `  · with apply, the old cover ${old} goes to the trash`);
  return path;
}
