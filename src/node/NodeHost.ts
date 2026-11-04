// The Node side of the ports, for the command line: the vault is read from disk, writes are staged in memory and reach the disk only with
// --apply, so every command can show its plan first. Questions get the answers
// a careful default gives, written to the output so the user can review them.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import type { DisambiguationData, DisambiguationResult, Frontmatter, Http, NoteRef, Ui, VaultPort } from "../ports";
import { parseFrontmatter, renderNote, splitNote } from "./frontmatter";

export interface Change {
  path: string;
  action: "create" | "modify";
}

function nfc(s: string): string {
  return s.normalize("NFC");
}

function basenameOf(path: string): string {
  return posix.basename(path).replace(/\.md$/i, "");
}

export class NodeVault implements VaultPort {
  /** Planned or applied writes, in order. */
  readonly changes: Change[] = [];
  private texts = new Map<string, string>();
  private frontmatters = new Map<string, Frontmatter | undefined>();

  constructor(readonly root: string, private apply: boolean) {
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

  private write(path: string, text: string, action: Change["action"]): void {
    this.store(path, text);
    if (!this.changes.some((c) => c.path === path)) this.changes.push({ path, action });
    if (this.apply) {
      mkdirSync(join(this.root, posix.dirname(path)), { recursive: true });
      writeFileSync(join(this.root, path), text, "utf8");
    }
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
    if (this.apply && path) mkdirSync(join(this.root, path), { recursive: true });
  }

  async create(path: string, content: string): Promise<NoteRef> {
    const rel = nfc(path);
    if (this.exists(rel)) throw new Error(`Already exists: ${rel}`);
    this.write(rel, content, "create");
    return { path: rel, basename: basenameOf(rel) };
  }

  async processFrontMatter(path: string, fn: (fm: Frontmatter) => void): Promise<void> {
    const rel = nfc(path);
    const text = await this.read(rel);
    const { yaml, body } = splitNote(text);
    const fm = structuredClone(parseFrontmatter(yaml) ?? {});
    fn(fm);
    const next = renderNote(fm, body);
    if (next !== text) this.write(rel, next, this.changes.find((c) => c.path === rel)?.action ?? "modify");
  }

  async process(path: string, fn: (text: string) => string): Promise<void> {
    const rel = nfc(path);
    const text = await this.read(rel);
    const next = fn(text);
    if (next !== text) this.write(rel, next, this.changes.find((c) => c.path === rel)?.action ?? "modify");
  }

  async rename(): Promise<NoteRef | null> {
    return null; // only Obsidian can update the links
  }

  resolveLink(linkpath: string, sourcePath: string): NoteRef | null {
    const target = nfc(linkpath.split("|")[0].split("#")[0].trim()).toLowerCase();
    if (!target) return null;
    const paths = [...this.texts.keys()];
    const byPath = paths.find((p) => p.toLowerCase() === target || p.toLowerCase() === `${target}.md`);
    const hits = byPath ? [byPath] : paths.filter((p) => basenameOf(p).toLowerCase() === posix.basename(target));
    if (!hits.length) return null;
    // Several notes with the same name: Obsidian prefers the one next to the source.
    const dir = posix.dirname(sourcePath);
    const best = hits.find((p) => posix.dirname(p) === dir) ?? hits.sort()[0];
    return { path: best, basename: basenameOf(best) };
  }
}

export const nodeHttp: Http = async ({ url, headers }) => {
  const response = await fetch(url, {
    headers: { "User-Agent": "SecondBrain/0.4 (personal bibliography)", ...headers },
  });
  const text = await response.text();
  let json: any = undefined;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON (arXiv Atom, ORCID search): callers read `text`.
  }
  return { status: response.status, text, json };
};

/** Answers without asking, and says what it chose. */
export class NodeUi implements Ui {
  readonly decisions: string[] = [];

  /** `apply` false: a preview, so nothing has been imported yet. */
  constructor(private log: (line: string) => void, private apply = true) {}

  notice(message: string): void {
    const text = this.apply ? message : message.replace(/^✅ Imported:/, "Da importare:");
    this.log(text.replace(/\n/g, " "));
  }

  async confirmOverflow(total: number, max: number, visible: number): Promise<boolean> {
    this.decisions.push(`${total} authors (over ${max}): linked only the first${visible > 1 ? ` and the next ones up to ${visible}` : ""}, full list in the BibTeX`);
    return true;
  }

  async disambiguate(data: DisambiguationData): Promise<DisambiguationResult> {
    if (data.match === "fullName") {
      this.decisions.push(`${data.incoming.label}: same name as [[${data.candidate.label}]], using the existing note`);
      return { choice: "same" };
    }
    this.decisions.push(`${data.incoming.label}: may be the same person as "${data.candidate.label}", creating a new note`);
    return { choice: "different" };
  }

  open(): void {}
}
