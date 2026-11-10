// The Node side of the vault port: the notes of a folder on disk, for the tests
// and for checking a real vault where Obsidian is not available (VAULT=<folder>
// npm test, also on GitHub). Writes reach the disk; a preview stands a
// StagedVault in front, as the command line does in Obsidian.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import type { Frontmatter, NoteRef, VaultPort } from "../ports";
import { parseFrontmatter, renderNote, splitNote } from "./frontmatter";

function nfc(s: string): string {
  return s.normalize("NFC");
}

function basenameOf(path: string): string {
  return posix.basename(path).replace(/\.md$/i, "");
}

export class NodeVault implements VaultPort {
  private texts = new Map<string, string>();
  private frontmatters = new Map<string, Frontmatter | undefined>();
  /** Other files, such as PDFs: links can point to them. */
  protected files = new Set<string>();

  constructor(readonly root: string) {
    this.scan("");
  }

  private scan(dir: string): void {
    for (const entry of readdirSync(join(this.root, dir), { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "__pycache__") continue;
      const rel = nfc(dir ? `${dir}/${entry.name}` : entry.name);
      if (entry.isDirectory()) {
        this.scan(rel);
      } else if (entry.name.toLowerCase().endsWith(".md")) {
        this.store(rel, readFileSync(join(this.root, rel), "utf8"));
      } else {
        this.files.add(rel);
      }
    }
  }

  private store(path: string, text: string): void {
    this.texts.set(path, text);
    let fm: Frontmatter | undefined;
    try {
      fm = parseFrontmatter(splitNote(text).yaml);
    } catch {
      fm = undefined; // invalid YAML: the lint reports it
    }
    this.frontmatters.set(path, fm);
  }

  private write(path: string, text: string): void {
    this.store(path, text);
    mkdirSync(join(this.root, posix.dirname(path)), { recursive: true });
    writeFileSync(join(this.root, path), text, "utf8");
  }

  text(path: string): string | undefined {
    return this.texts.get(path);
  }

  markdownFiles(): NoteRef[] {
    return [...this.texts.keys()].sort().map((path) => ({ path, basename: basenameOf(path) }));
  }

  frontmatter(path: string): Frontmatter | undefined {
    return this.frontmatters.get(nfc(path));
  }

  exists(path: string): boolean {
    const key = nfc(path).toLowerCase();
    return [...this.texts.keys()].some((p) => p.toLowerCase() === key) || existsSync(join(this.root, path));
  }

  async read(path: string): Promise<string> {
    const text = this.texts.get(nfc(path));
    if (text === undefined) throw new Error(`Note not found: ${path}`);
    return text;
  }

  async ensureFolder(path: string): Promise<void> {
    if (path) mkdirSync(join(this.root, path), { recursive: true });
  }

  async create(path: string, content: string): Promise<NoteRef> {
    const rel = nfc(path);
    if (this.exists(rel)) throw new Error(`Already exists: ${rel}`);
    this.write(rel, content);
    return { path: rel, basename: basenameOf(rel) };
  }

  async processFrontMatter(path: string, fn: (fm: Frontmatter) => void): Promise<void> {
    const rel = nfc(path);
    const text = await this.read(rel);
    const { yaml, body } = splitNote(text);
    const fm = structuredClone(parseFrontmatter(yaml) ?? {});
    fn(fm);
    const next = renderNote(fm, body);
    if (next !== text) this.write(rel, next);
  }

  async process(path: string, fn: (text: string) => string): Promise<void> {
    const rel = nfc(path);
    const text = await this.read(rel);
    const next = fn(text);
    if (next !== text) this.write(rel, next);
  }

  async rename(_path: string, _newPath: string): Promise<NoteRef | null> {
    return null; // only Obsidian can update the links
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const bytes = readFileSync(join(this.root, path));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  async createBinary(path: string, data: ArrayBuffer): Promise<void> {
    if (this.exists(path)) throw new Error(`Already exists: ${path}`);
    mkdirSync(join(this.root, posix.dirname(path)), { recursive: true });
    writeFileSync(join(this.root, path), Buffer.from(data));
    this.files.add(nfc(path));
  }

  async trash(_path: string): Promise<boolean> {
    return false; // the trash is Obsidian's
  }

  resolveLink(linkpath: string, sourcePath: string): NoteRef | null {
    const target = nfc(linkpath.split("|")[0].split("#")[0].trim()).toLowerCase();
    if (!target) return null;
    const paths = [...this.texts.keys(), ...this.files];
    const byPath = paths.find((p) => p.toLowerCase() === target || p.toLowerCase() === `${target}.md`);
    const hits = byPath ? [byPath] : paths.filter((p) => basenameOf(p).toLowerCase() === posix.basename(target));
    if (!hits.length) return null;
    // Several notes with the same name: Obsidian prefers the one next to the source.
    const dir = posix.dirname(sourcePath);
    const best = hits.find((p) => posix.dirname(p) === dir) ?? hits.sort()[0];
    return { path: best, basename: basenameOf(best) };
  }
}
