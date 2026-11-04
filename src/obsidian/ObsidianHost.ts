// The Obsidian side of the ports: vault access through Obsidian's APIs (which
// keep links up to date on rename) and questions through modals.

import { App, normalizePath, Notice, requestUrl, TFile } from "obsidian";
import type { DisambiguationData, DisambiguationResult, Frontmatter, Http, NoteRef, Ui, VaultPort } from "../ports";
import { AuthorOverflowModal } from "./AuthorOverflowModal";
import { DisambiguationModal } from "./DisambiguationModal";

export function ref(file: TFile): NoteRef {
  return { path: file.path, basename: file.basename };
}

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
