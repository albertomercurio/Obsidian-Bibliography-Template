// ---------------------------------------------------------------------------
// Writes held back for a preview.
//
// Commands of the command line show what they would do before doing it. This
// vault stands in front of the host's: it reads through to it, keeps every
// write in memory and lists it, and passes the write on only with `apply`.
// Either way the run reads its own writes, so a preview takes the same path as
// the real run: an author created for the first paper is found for the next.
// ---------------------------------------------------------------------------

import type { Frontmatter, NoteRef, VaultPort } from "./ports";
import { splitNote } from "./schema";

/** The host's YAML: Obsidian's parseYaml and stringifyYaml, or the yaml package in Node. */
export interface YamlCodec {
  parse(text: string): unknown;
  stringify(data: Frontmatter): string;
}

export interface Change {
  path: string;
  action: "create" | "modify";
}

interface Staged {
  ref: NoteRef;
  text: string;
  fm: Frontmatter | undefined;
}

const keyOf = (path: string) => path.normalize("NFC").toLowerCase();
const basenameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");

export class StagedVault implements VaultPort {
  /** Writes of this run, in order: planned in a preview, done with `apply`. */
  readonly changes: Change[] = [];
  private staged = new Map<string, Staged>();

  constructor(private base: VaultPort, private yaml: YamlCodec, readonly apply: boolean) {}

  private parse(text: string): Frontmatter | undefined {
    const { yaml } = splitNote(text);
    if (yaml === null) return undefined;
    try {
      const data = this.yaml.parse(yaml);
      return data && typeof data === "object" && !Array.isArray(data) ? (data as Frontmatter) : {};
    } catch {
      return undefined;
    }
  }

  private stage(ref: NoteRef, text: string, action: Change["action"]): void {
    this.staged.set(keyOf(ref.path), { ref, text, fm: this.parse(text) });
    if (!this.changes.some((change) => change.path === ref.path)) this.changes.push({ path: ref.path, action });
  }

  private ref(path: string): NoteRef {
    return this.staged.get(keyOf(path))?.ref ?? { path, basename: basenameOf(path) };
  }

  markdownFiles(): NoteRef[] {
    const files = this.base.markdownFiles();
    const known = new Set(files.map(({ path }) => keyOf(path)));
    return [...files, ...[...this.staged.values()].map(({ ref }) => ref).filter(({ path }) => !known.has(keyOf(path)))];
  }

  frontmatter(path: string): Frontmatter | undefined {
    const staged = this.staged.get(keyOf(path));
    return staged ? staged.fm : this.base.frontmatter(path);
  }

  exists(path: string): boolean {
    return this.staged.has(keyOf(path)) || this.base.exists(path);
  }

  async read(path: string): Promise<string> {
    return this.staged.get(keyOf(path))?.text ?? this.base.read(path);
  }

  async ensureFolder(path: string): Promise<void> {
    if (this.apply) await this.base.ensureFolder(path);
  }

  async create(path: string, content: string): Promise<NoteRef> {
    if (this.exists(path)) throw new Error(`Already exists: ${path}`);
    const ref = this.apply ? await this.base.create(path, content) : { path, basename: basenameOf(path) };
    this.stage(ref, content, "create");
    return ref;
  }

  async processFrontMatter(path: string, fn: (fm: Frontmatter) => void): Promise<void> {
    const text = await this.read(path);
    const fm = this.parse(text) ?? {};
    const before = JSON.stringify(fm);
    fn(fm);
    if (JSON.stringify(fm) === before) return;
    if (this.apply) await this.base.processFrontMatter(path, fn);
    const yaml = Object.keys(fm).length ? this.yaml.stringify(fm) : "";
    const body = splitNote(text).body.replace(/^\n+/, "");
    this.stage(this.ref(path), `---\n${yaml.endsWith("\n") || !yaml ? yaml : `${yaml}\n`}---\n${body}`, "modify");
  }

  async process(path: string, fn: (text: string) => string): Promise<void> {
    const text = await this.read(path);
    const next = fn(text);
    if (next === text) return;
    if (this.apply) await this.base.process(path, fn);
    this.stage(this.ref(path), next, "modify");
  }

  /** Renames only for real: a preview leaves the name, and says so. */
  async rename(path: string, newPath: string): Promise<NoteRef | null> {
    if (!this.apply) return null;
    const renamed = await this.base.rename(path, newPath);
    const staged = this.staged.get(keyOf(path));
    if (renamed && staged) {
      this.staged.delete(keyOf(path));
      this.staged.set(keyOf(renamed.path), { ...staged, ref: renamed });
    }
    return renamed;
  }

  resolveLink(linkpath: string, sourcePath: string): NoteRef | null {
    const found = this.base.resolveLink(linkpath, sourcePath);
    if (found) return found;
    const target = keyOf(linkpath.split("|")[0].split("#")[0].trim());
    if (!target) return null;
    const notes = [...this.staged.values()].map(({ ref }) => ref);
    return (
      notes.find(({ path }) => keyOf(path) === target || keyOf(path) === `${target}.md`) ??
      notes.find(({ basename }) => keyOf(basename) === target.slice(target.lastIndexOf("/") + 1)) ??
      null
    );
  }
}
