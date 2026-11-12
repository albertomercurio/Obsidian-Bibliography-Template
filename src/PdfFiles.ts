// ---------------------------------------------------------------------------
// What the plugin reads in a PDF, without pdf.js: the DOI or arXiv id of the
// paper on its first pages, and where Figure 1 is, for a cover. Both work on
// the text runs the host extracts (PdfPort), so the tests run them in Node.
// ---------------------------------------------------------------------------

import type { Box, PdfPage, PdfText } from "./ports";

const DOI = /10\.\d{4,9}\/[^\s"<>{}]+/g;
/** "arXiv:2207.09470v2", and ids before 2007: "arXiv:quant-ph/0101001v1". */
const ARXIV = /arXiv:\s*(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(v\d+)?/gi;

/** A DOI as printed, without the punctuation that follows it in the text. */
function cleanDoi(raw: string): string {
  let doi = raw.replace(/[.,;:'"\]]+$/, "");
  while (doi.endsWith(")") && (doi.match(/\(/g)?.length ?? 0) < (doi.match(/\)/g)?.length ?? 0)) doi = doi.slice(0, -1);
  return doi;
}

/**
 * The identifier of the paper a PDF is, from the text of its first pages: the
 * DOI printed with a label (DOI:, doi.org/), else the only DOI, else the only
 * arXiv id. Several candidates: an error that lists them.
 */
export function identifierOf(pages: PdfPage[]): string {
  const text = pages.map((page) => page.items.map((item) => item.str).join(" ")).join("\n");
  const labelled: string[] = [];
  const all: string[] = [];
  for (const match of text.matchAll(DOI)) {
    const doi = cleanDoi(match[0]);
    const before = text.slice(Math.max(0, match.index! - 12), match.index).toLowerCase();
    if (/(doi\s*[:.]?\s*|doi\.org\/)$/.test(before) && !labelled.some((d) => d.toLowerCase() === doi.toLowerCase())) labelled.push(doi);
    if (!all.some((d) => d.toLowerCase() === doi.toLowerCase())) all.push(doi);
  }
  const dois = labelled.length ? labelled : all;
  if (dois.length === 1) return dois[0];
  if (dois.length > 1) throw new Error(`several DOIs in the first pages (${dois.join(", ")}): name the paper with id=`);
  const arxiv = [...new Set([...text.matchAll(ARXIV)].map((match) => match[1]))];
  if (arxiv.length === 1) return arxiv[0];
  if (arxiv.length > 1) throw new Error(`several arXiv ids in the first pages (${arxiv.join(", ")}): name the paper with id=`);
  throw new Error("no DOI or arXiv id in the first pages: name the paper with id=");
}

// ---- Figure 1 --------------------------------------------------------------------

/** Text items next to each other on one line: a word group, a line of prose, a label. */
interface Run {
  text: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** The type size of its longest piece of text: math symbols can be larger. */
  size: number;
  longest: number;
}

const words = (run: Run) => run.text.split(/\s+/).filter(Boolean).length;

function runsOf(items: PdfText[]): Run[] {
  const flat = items.filter((item) => !item.rotated && item.str.trim()).sort((a, b) => a.y + a.height - (b.y + b.height) || a.x - b.x);
  // Rows: items whose baselines are close.
  const rows: PdfText[][] = [];
  for (const item of flat) {
    const row = rows[rows.length - 1];
    const base = (it: PdfText) => it.y + 0.8 * it.height;
    if (row && Math.abs(base(item) - base(row[0])) < 0.35 * Math.min(item.height, row[0].height)) row.push(item);
    else rows.push([item]);
  }
  // Runs: items of a row with no wide gap between them.
  const runs: Run[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let run: Run | null = null;
    for (const item of row) {
      const gap = run ? item.x - run.x1 : Infinity;
      if (run && gap < 0.8 * Math.min(item.height, run.size)) { // less than a column gap
        run.text += gap > 0.15 * item.height && !run.text.endsWith(" ") && !item.str.startsWith(" ") ? ` ${item.str}` : item.str;
        run.x1 = Math.max(run.x1, item.x + item.width);
        run.y0 = Math.min(run.y0, item.y);
        run.y1 = Math.max(run.y1, item.y + item.height);
        if (item.str.trim().length > run.longest) [run.size, run.longest] = [item.height, item.str.trim().length];
      } else {
        run = { text: item.str, x0: item.x, x1: item.x + item.width, y0: item.y, y1: item.y + item.height, size: item.height, longest: item.str.trim().length };
        runs.push(run);
      }
    }
  }
  for (const run of runs) run.text = run.text.trim();
  return runs;
}

// "FIG. 1.", "FIG. 1 (color online).", "Figure 1.", "Fig. 1 |", "Fig. 1 Title", not "Fig. 1(a) shows".
const CAPTION = /^(fig(ure)?\.?)\s*1(?!\d)(\s*[.:|]|\s+\(|\s+[A-Z]|\s*$)/i;

/**
 * Where Figure 1 is: the page (from 1) and the box above its caption, across
 * the caption's lines, below the nearest line of prose or the running head.
 * Captions are in a smaller type than the prose, which tells them from a line
 * that starts with "Fig. 1 (a)". The host trims the white margins when it cuts
 * the picture. Null: no caption with room for a picture above it.
 */
export function figureOne(pages: PdfPage[]): { page: number; box: Box } | null {
  const candidates: { page: number; runs: Run[]; caption: Run; body: number; small: boolean }[] = [];
  for (const [index, page] of pages.entries()) {
    const runs = runsOf(page.items);
    const prose = runs.filter((run) => words(run) >= 5);
    if (!prose.length) continue;
    const sizes = prose.map((run) => Math.round(run.size * 2) / 2).sort((a, b) => a - b);
    const body = sizes[Math.floor(sizes.length / 2)];
    for (const caption of runs.filter((run) => CAPTION.test(run.text))) {
      candidates.push({ page: index, runs, caption, body, small: caption.size < 0.97 * body });
    }
  }
  for (const candidate of [...candidates.filter((c) => c.small), ...candidates.filter((c) => !c.small)]) {
    const box = boxAbove(pages[candidate.page], candidate.runs, candidate.caption, candidate.body);
    if (box) return { page: candidate.page + 1, box };
  }
  return null;
}

function boxAbove(page: PdfPage, runs: Run[], caption: Run, body: number): Box | null {
  const prose = runs.filter((run) => words(run) >= 5);
  const left = Math.min(...prose.map((run) => run.x0));
  const right = Math.max(...prose.map((run) => run.x1));
  const middle = (left + right) / 2;
  const crossing = prose.filter((run) => run.x0 < middle - 5 && run.x1 > middle + 5).length;
  // The caption's lines: its width is the figure's, in a page of columns.
  const lines = runs.filter(
    (run) => run.y0 >= caption.y0 - 1 && run.y0 < caption.y0 + 6 * caption.size && run.x0 >= caption.x0 - 5 && run.x0 < caption.x1
  );
  let x0 = Math.min(...lines.map((run) => run.x0));
  let x1 = Math.max(...lines.map((run) => run.x1));
  if (crossing > 0.6 * prose.length) [x0, x1] = [left, right]; // one column of text
  else if (x1 - x0 < 0.3 * (right - left)) [x0, x1] = x0 < middle ? [left, middle] : [middle, right]; // a short caption
  const width = x1 - x0;
  const overlap = (run: Run) => Math.max(0, Math.min(run.x1, x1) - Math.max(run.x0, x0));
  const above = runs.filter((run) => run !== caption && run.y1 <= caption.y0 + 0.5 && overlap(run) > 0);

  let top = 0;
  // The running head: the rows at the top of the page, as long as each has some
  // text, or, first of them, only a page number (its logo may be a picture).
  const head: Run[][] = [];
  for (const run of above.filter((run) => run.y1 < 0.15 * page.height).sort((a, b) => a.y0 - b.y0)) {
    const row = head[head.length - 1];
    if (row && Math.abs(run.y0 - row[0].y0) < 0.5 * row[0].size) row.push(run);
    else head.push([run]);
  }
  for (const [i, row] of head.entries()) {
    const text = row.some((run) => run.text.replace(/\s/g, "").length >= 7);
    const pageNumber = i === 0 && row.every((run) => /^\d{1,4}$/.test(run.text));
    if (!text && !pageNumber) break;
    top = Math.max(top, ...row.map((run) => run.y1 + 0.3 * run.size));
  }
  // The nearest line of prose above, in the column: on a row, a stretch without
  // wide gaps, in the body's type, with five words or the last words of a
  // paragraph from the column's edge. Labels in a figure are smaller or sparse.
  const rows: Run[][] = [];
  const inColumn = above.filter((run) => overlap(run) >= 0.5 * (run.x1 - run.x0)).sort((a, b) => a.y1 - b.y1 || a.x0 - b.x0);
  for (const run of inColumn) {
    const row = rows.find((row) => Math.abs(row[0].y1 - run.y1) < 0.35 * Math.min(run.size, row[0].size));
    if (row) row.push(run);
    else rows.push([run]);
  }
  const stretches = rows.flatMap((row) => {
    row.sort((a, b) => a.x0 - b.x0);
    const out: Run[][] = [[row[0]]];
    for (const run of row.slice(1)) {
      const last = out[out.length - 1];
      if (run.x0 - last[last.length - 1].x1 <= 1.5 * body) last.push(run);
      else out.push([run]);
    }
    return out;
  });
  for (const stretch of stretches) {
    const alphabetic = stretch.map((run) => run.text).join(" ").split(/\s+/).filter((word) => /\p{L}{2}/u.test(word)).length;
    const letters = stretch.reduce((sum, run) => sum + run.longest, 0);
    const size = stretch.reduce((sum, run) => sum + run.size * run.longest, 0) / Math.max(1, letters);
    const lastLine = alphabetic >= 2 && Math.abs(stretch[0].x0 - x0) <= 4;
    if ((alphabetic >= 5 || lastLine) && Math.abs(size - body) <= 0.08 * body) top = Math.max(top, ...stretch.map((run) => run.y1));
  }
  const bottom = caption.y0 - 1;
  if (bottom - top < 40) return null; // no room for a picture: the caption is beside it, or it is not a caption
  return { x: x0 - 3, y: top + 1, width: width + 6, height: bottom - top - 1 };
}
