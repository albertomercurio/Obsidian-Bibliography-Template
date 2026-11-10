// The Obsidian side of the ports: vault access through Obsidian's APIs (which
// keep links up to date on rename) and questions through modals.

import { App, loadPdfJs, normalizePath, Notice, parseYaml, requestUrl, stringifyYaml, TFile } from "obsidian";
import type { Box, DisambiguationData, DisambiguationResult, Frontmatter, Http, NoteRef, PdfPage, PdfPort, PdfText, Ui, VaultPort } from "../ports";
import type { YamlCodec } from "../StagedVault";
import { AuthorOverflowModal } from "./AuthorOverflowModal";
import { DisambiguationModal } from "./DisambiguationModal";

export function ref(file: TFile): NoteRef {
  return { path: file.path, basename: file.basename };
}

export const obsidianYaml: YamlCodec = { parse: parseYaml, stringify: stringifyYaml };

export const obsidianHttp: Http = async ({ url, headers }) => {
  const response = await requestUrl({ url, headers, throw: false });
  let json: any = undefined;
  try {
    json = response.json;
  } catch {
    // Not JSON (arXiv Atom, ORCID search): callers read `text`.
  }
  return { status: response.status, text: response.text, json };
};

export class ObsidianVault implements VaultPort {
  constructor(private app: App) {}

  private file(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) throw new Error(`Note not found: ${path}`);
    return file;
  }

  markdownFiles(): NoteRef[] {
    return this.app.vault.getMarkdownFiles().map(ref);
  }

  frontmatter(path: string): Frontmatter | undefined {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    return file instanceof TFile ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
  }

  exists(path: string): boolean {
    return Boolean(this.app.vault.getAbstractFileByPath(normalizePath(path)));
  }

  read(path: string): Promise<string> {
    return this.app.vault.cachedRead(this.file(path));
  }

  async ensureFolder(path: string): Promise<void> {
    const norm = normalizePath(path);
    if (norm && !this.app.vault.getAbstractFileByPath(norm)) await this.app.vault.createFolder(norm);
  }

  async create(path: string, content: string): Promise<NoteRef> {
    return ref(await this.app.vault.create(normalizePath(path), content));
  }

  processFrontMatter(path: string, fn: (fm: Frontmatter) => void): Promise<void> {
    return this.app.fileManager.processFrontMatter(this.file(path), fn);
  }

  async process(path: string, fn: (text: string) => string): Promise<void> {
    await this.app.vault.process(this.file(path), fn);
  }

  async rename(path: string, newPath: string): Promise<NoteRef | null> {
    const file = this.file(path);
    await this.app.fileManager.renameFile(file, normalizePath(newPath)); // updates every link
    return ref(file); // TFile is updated in place
  }

  resolveLink(linkpath: string, sourcePath: string): NoteRef | null {
    const file = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
    return file ? ref(file) : null;
  }

  readBinary(path: string): Promise<ArrayBuffer> {
    return this.app.vault.readBinary(this.file(path));
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (file instanceof TFile) await this.app.vault.modifyBinary(file, data);
    else await this.app.vault.createBinary(normalizePath(path), data);
  }

  async trash(path: string): Promise<boolean> {
    await this.app.fileManager.trashFile(this.file(path)); // the trash chosen in Obsidian's settings
    return true;
  }
}

/** PDFs through the pdf.js that Obsidian ships. */
export class ObsidianPdf implements PdfPort {
  constructor(private app: App) {}

  private async open(path: string): Promise<any> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) throw new Error(`No file at ${path}`);
    const pdfjs = await loadPdfJs();
    return pdfjs.getDocument({ data: new Uint8Array(await this.app.vault.readBinary(file)) }).promise;
  }

  async pages(path: string, count: number): Promise<PdfPage[]> {
    const doc = await this.open(path);
    try {
      const pages: PdfPage[] = [];
      for (let number = 1; number <= Math.min(count, doc.numPages); number++) {
        const page = await doc.getPage(number);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const items: PdfText[] = [];
        for (const item of content.items) {
          if (typeof item.str !== "string" || !item.str.trim()) continue;
          const [a, b, c, d, e, f] = item.transform as number[];
          const size = Math.hypot(c, d) || item.height || 1;
          const [x, baseline] = viewport.convertToViewportPoint(e, f);
          // From the baseline: ascent above it, descent below.
          items.push({ str: item.str, x, y: baseline - 0.8 * size, width: item.width, height: size, rotated: Math.abs(b) > 1e-3 || Math.abs(c) > 1e-3 || a <= 0 });
        }
        pages.push({ width: viewport.width, height: viewport.height, items });
      }
      return pages;
    } finally {
      await doc.destroy();
    }
  }

  async png(path: string, number: number, box: Box, width: number): Promise<ArrayBuffer> {
    const doc = await this.open(path);
    try {
      const page = await doc.getPage(number);
      const scale = Math.min(6, width / box.width);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(box.width * scale);
      canvas.height = Math.ceil(box.height * scale);
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      // Only the box: the page shifted so that its corner is the canvas's. The
      // print intent does not wait for animation frames, which a window in the
      // background does not get.
      const task = page.render({ canvasContext: context, viewport, intent: "print", transform: [1, 0, 0, 1, -box.x * scale, -box.y * scale] });
      let timer: number | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => {
          task.cancel();
          reject(new Error("the page took more than 30 s to draw"));
        }, 30000);
      });
      try {
        await Promise.race([task.promise, timeout]);
      } finally {
        window.clearTimeout(timer);
      }
      return trimmedPng(canvas);
    } finally {
      await doc.destroy();
    }
  }
}

/** The canvas without its white margins, keeping a thin border, as PNG bytes. */
function trimmedPng(canvas: HTMLCanvasElement): ArrayBuffer {
  const { width, height } = canvas;
  const pixels = canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
  let top = height, bottom = -1, left = width, right = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = 4 * (y * width + x);
      if (Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 235) continue; // white enough
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  if (bottom < 0) throw new Error("no picture above the caption of Figure 1");
  let out = canvas;
  {
    const pad = Math.round(0.02 * width);
    const x0 = Math.max(0, left - pad), y0 = Math.max(0, top - pad);
    const x1 = Math.min(width, right + 1 + pad), y1 = Math.min(height, bottom + 1 + pad);
    out = document.createElement("canvas");
    out.width = x1 - x0;
    out.height = y1 - y0;
    const context = out.getContext("2d")!;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, out.width, out.height);
    context.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  }
  // toDataURL, not toBlob: it does not wait, in a window in the background either.
  const binary = atob(out.toDataURL("image/png").split(",")[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export class ObsidianUi implements Ui {
  constructor(private app: App) {}

  notice(message: string, timeout?: number): void {
    new Notice(message, timeout);
  }

  confirmOverflow(total: number, max: number, visible: number): Promise<boolean> {
    return new AuthorOverflowModal(this.app, total, max, visible).ask();
  }

  disambiguate(data: DisambiguationData): Promise<DisambiguationResult> {
    return new DisambiguationModal(this.app, data).ask();
  }

  open(basename: string): void {
    this.app.workspace.openLinkText(basename, "", false);
  }
}

/** The image in the clipboard, such as a screenshot; null when there is none. */
export async function clipboardImage(): Promise<{ data: ArrayBuffer; ext: string } | null> {
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((type) => type.startsWith("image/"));
      if (!type) continue;
      const data = await (await item.getType(type)).arrayBuffer();
      return { data, ext: type === "image/jpeg" ? "jpg" : type.slice("image/".length).replace(/\+.*$/, "") };
    }
  } catch {
    // Not allowed or not supported here: Electron's clipboard below, on desktop.
  }
  try {
    const image = (window as any).require?.("electron")?.clipboard?.readImage?.();
    if (image && !image.isEmpty()) {
      const png: Uint8Array = image.toPNG();
      return { data: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer, ext: "png" };
    }
  } catch {
    // Mobile: no Electron.
  }
  return null;
}
