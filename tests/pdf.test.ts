// PDFs: the identifier printed in them, Figure 1 for a cover, and the add and
// cover commands that move, link and cut them. pdf.js is Obsidian's, so the
// pages here are text runs: four real layouts (letters replaced by x) and
// small made-up ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { addCommand, type CommandHost, coverCommand } from "../src/CommandLine";
import { NodeVault } from "../src/node/NodeHost";
import { nodeYaml, parseFrontmatter, splitNote } from "../src/node/frontmatter";
import { figureOne, identifierOf } from "../src/PdfFiles";
import type { Box, NoteRef, PdfPage, PdfPort } from "../src/ports";
import { DEFAULT_SETTINGS, type PluginSettings } from "../src/types";
import { ARTICLE, DOI, WORK, sampleVault } from "./helpers";

const page = (...lines: string[]): PdfPage => ({
  width: 600,
  height: 800,
  items: lines.map((str, i) => ({ str, x: 50, y: 50 + 12 * i, width: 6 * str.length, height: 10 })),
});

test("the identifier of a PDF: a labelled DOI first, else the only DOI or arXiv id", () => {
  assert.equal(identifierOf([page("Phys. Rev. Lett. 109, 063601", "DOI: 10.1103/PhysRevLett.109.063601", "see 10.1103/PhysRevA.87.013839.")]), "10.1103/PhysRevLett.109.063601");
  assert.equal(identifierOf([page("https://doi.org/10.1140/epjp/s13360-022-03571-0")]), "10.1140/epjp/s13360-022-03571-0");
  assert.equal(identifierOf([page("as shown in (10.1016/S0370-2693(00)01234-5).")]), "10.1016/S0370-2693(00)01234-5");
  assert.equal(identifierOf([page("arXiv:2603.13030v2 [quant-ph] 3 Mar 2026")]), "2603.13030");
  assert.throws(() => identifierOf([page("10.1103/PhysRevA.1.1 and 10.1103/PhysRevA.2.2")]), /several DOIs .*: name the paper with id=/);
  assert.throws(() => identifierOf([page("no identifier here")]), /no DOI or arXiv id/);
});

const LAYOUTS = JSON.parse(readFileSync("tests/fixtures/pdf-pages.json", "utf8")).papers as Record<string, [number, number, any[][]][]>;
const pagesOf = (name: string): PdfPage[] =>
  LAYOUTS[name].map(([width, height, items]) => ({
    width,
    height,
    items: items.map(([str, x, y, w, h, rotated]) => ({ str, x, y, width: w, height: h, rotated: Boolean(rotated) })),
  }));

/** The box holds the picture (measured by hand, in points) and stays clear of the text around it. */
function holds(box: Box, picture: [number, number, number, number], clear: { above: number; below: number }) {
  const [x0, y0, x1, y1] = picture;
  assert.ok(box.x <= x0 && box.x + box.width >= x1, `x ${box.x}…${box.x + box.width} holds ${x0}…${x1}`);
  assert.ok(box.y <= y0 && box.y + box.height >= y1, `y ${box.y}…${box.y + box.height} holds ${y0}…${y1}`);
  assert.ok(box.y >= clear.above && box.y + box.height <= clear.below, `y ${box.y}…${box.y + box.height} within ${clear.above}…${clear.below}`);
}

test("Figure 1 in four layouts: top of a column, under prose, after a cover page and under a logo", () => {
  const ludwig = figureOne(pagesOf("ludwig"))!; // PRL: under the running head, left column
  assert.equal(ludwig.page, 1);
  holds(ludwig.box, [52, 46, 297, 112], { above: 40, below: 128 });
  const komar = figureOne(pagesOf("komar"))!; // PRA: a tall figure, two panels
  holds(komar.box, [72, 69, 296, 305], { above: 50, below: 314 });
  const stannigel = figureOne(pagesOf("stannigel"))!; // PRL first page: under a paragraph, right column
  assert.equal(stannigel.page, 1);
  holds(stannigel.box, [317, 500, 560, 610], { above: 455, below: 621 });
  const basiri = figureOne(pagesOf("basiri"))!; // NJP: a cover page first, a page number beside a logo
  assert.equal(basiri.page, 2);
  holds(basiri.box, [147, 112, 420, 288], { above: 100, below: 302 });
});

test("no Figure 1: a line of prose that cites it is not a caption", () => {
  assert.equal(figureOne([page("In Fig. 1(a) we show the spectrum of the model as a function of g.")]), null);
  assert.equal(figureOne([page("Fig. 1(a) shows the spectrum of the model as a function of the coupling.")]), null);
  assert.equal(figureOne([page("Nothing to see", "here")]), null);
});

// ---- The commands, in Node ----------------------------------------------------

/** A vault that moves files, as Obsidian does, and keeps what went to the trash. */
class MovingVault extends NodeVault {
  trashed: string[] = [];
  async rename(path: string, newPath: string): Promise<NoteRef | null> {
    mkdirSync(dirname(join(this.root, newPath)), { recursive: true });
    renameSync(join(this.root, path), join(this.root, newPath));
    this.files.delete(path);
    this.files.add(newPath);
    return { path: newPath, basename: newPath.slice(newPath.lastIndexOf("/") + 1) };
  }
  async trash(path: string): Promise<boolean> {
    this.trashed.push(path);
    return true;
  }
}

/** A PDF reader that knows one paper: its first page prints the DOI, its second has Figure 1. */
const reader: PdfPort = {
  async pages() {
    return [page("Physical Review Letters", `DOI: ${DOI}`), ...pagesOf("ludwig")];
  },
  async png() {
    return new Uint8Array([137, 80, 78, 71]).buffer;
  },
};

const REFERENCED = "10.1103/PhysRevA.87.013839";
const citing = async ({ url }: { url: string }) =>
  url.includes("api.crossref.org")
    ? { status: 200, text: "", json: { message: { ...WORK, reference: [{ key: "1", DOI: REFERENCED }, { key: "2", unstructured: "no DOI" }] } } }
    : { status: 404, text: "", json: null };

const settings: PluginSettings = { ...DEFAULT_SETTINGS, pdfFolder: "Files", coverProperty: "Cover", logFile: "log.md" };
const host = (vault: NodeVault): CommandHost => ({ vault, http: citing, settings, yaml: nodeYaml, pdf: reader, pause: 0 });
const props = (root: string, path: string) => parseFrontmatter(splitNote(readFileSync(join(root, path), "utf8")).yaml)!;

function inboxVault(): string {
  const root = sampleVault();
  mkdirSync(join(root, "Inbox"), { recursive: true });
  writeFileSync(join(root, "Inbox/paper.pdf"), "%PDF-1.4 the paper");
  mkdirSync(join(root, "Articles"), { recursive: true });
  writeFileSync(join(root, "Articles/Cited.md"), `---\nType: Article\nTitle: Cited\nDOI: ${REFERENCED}\n---\n`);
  return root;
}

test("add pdf= reads the DOI, imports, moves the PDF next to the others with the citation key, and cuts a cover", async () => {
  const root = inboxVault();
  const preview = await addCommand(host(new MovingVault(root)), { pdf: "Inbox/paper.pdf", cover: true, apply: false });
  assert.match(preview, new RegExp(`^Inbox/paper\\.pdf: ${DOI.replace(/\./g, "\\.")}$`, "m"));
  assert.match(preview, /^ {2}· cites, in the vault: \[\[Cited\]\]$/m);
  assert.match(preview, /^\? Inbox\/paper\.pdf → Files\/Macri2022SpontaneousScatteringRaman\.pdf {2}\(move\)$/m);
  assert.match(preview, /^\? Files\/Macri2022SpontaneousScatteringRaman-cover\.png {2}\(create\)$/m);
  assert.ok(existsSync(join(root, "Inbox/paper.pdf")) && !existsSync(join(root, ARTICLE)), "a preview writes nothing");

  const applied = await addCommand(host(new MovingVault(root)), { pdf: "Inbox/paper.pdf", cover: true, apply: true });
  assert.match(applied, /notes and 1 files written\.$/);
  assert.ok(!existsSync(join(root, "Inbox/paper.pdf")));
  assert.equal(readFileSync(join(root, "Files/Macri2022SpontaneousScatteringRaman.pdf"), "utf8"), "%PDF-1.4 the paper");
  assert.ok(existsSync(join(root, "Files/Macri2022SpontaneousScatteringRaman-cover.png")));
  const fm = props(root, ARTICLE);
  assert.deepEqual(fm.PDF, ["[[Macri2022SpontaneousScatteringRaman.pdf]]"]);
  assert.equal(fm.Cover, "[[Macri2022SpontaneousScatteringRaman-cover.png]]");
  assert.match(readFileSync(join(root, "log.md"), "utf8"), /\n- moved: Inbox\/paper\.pdf → Files\/Macri2022SpontaneousScatteringRaman\.pdf\n/);
});

test("add pdf= of a paper already there: a copy of its PDF goes to the trash, another PDF stays", async () => {
  const root = inboxVault();
  await addCommand(host(new MovingVault(root)), { pdf: "Inbox/paper.pdf", apply: true });
  writeFileSync(join(root, "Inbox/copy.pdf"), "%PDF-1.4 the paper");
  const vault = new MovingVault(root);
  const preview = await addCommand(host(vault), { pdf: "Inbox/copy.pdf", apply: false });
  assert.match(preview, /already exists in your vault/);
  assert.match(preview, /^ {2}· Inbox\/copy\.pdf is the same file as Files\/Macri2022SpontaneousScatteringRaman\.pdf, which the note links$/m);
  assert.match(preview, /with apply, Inbox\/copy\.pdf goes to the trash/);
  assert.deepEqual(vault.trashed, []);
  const applied = await addCommand(host(vault), { pdf: "Inbox/copy.pdf", apply: true });
  assert.match(applied, /- Inbox\/copy\.pdf: moved to the trash/);
  assert.deepEqual(vault.trashed, ["Inbox/copy.pdf"]);

  writeFileSync(join(root, "Inbox/other.pdf"), "%PDF-1.4 another version");
  const other = await addCommand(host(new MovingVault(root)), { pdf: "Inbox/other.pdf", apply: true });
  assert.match(other, /the note links another PDF, Files\/Macri2022SpontaneousScatteringRaman\.pdf: Inbox\/other\.pdf stays where it is/);
  assert.ok(existsSync(join(root, "Inbox/other.pdf")));
});

test("cover makes covers for references with a PDF and none, and only with apply", async () => {
  const root = inboxVault();
  await addCommand(host(new MovingVault(root)), { pdf: "Inbox/paper.pdf", apply: true });
  const preview = await coverCommand(host(new MovingVault(root)), { apply: false });
  assert.match(preview, /^ {2}· cover: Figure 1, page 2 of the PDF$/m);
  assert.match(preview, /Preview: 1 covers, nothing written/);
  assert.equal(props(root, ARTICLE).Cover, undefined);
  await coverCommand(host(new MovingVault(root)), { apply: true });
  assert.equal(props(root, ARTICLE).Cover, "[[Macri2022SpontaneousScatteringRaman-cover.png]]");
  assert.match(await coverCommand(host(new MovingVault(root)), { apply: false }), /Every reference with a PDF has a cover\./);
  await assert.rejects(coverCommand({ ...host(new MovingVault(root)), settings: DEFAULT_SETTINGS }, { apply: false }), /cover property in the settings/);
});
