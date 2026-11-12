// What counts as a DOI or an arXiv id, and where an arXiv id leads: the
// published version whenever Semantic Scholar or arXiv's own record names it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ArxivService } from "../src/ArxivService";
import { CrossrefService } from "../src/CrossrefService";
import { detectInput } from "../src/ImportService";
import { identifierOf } from "../src/PdfFiles";
import type { Http, HttpResponse } from "../src/ports";
import { DOI, WORK } from "./helpers";

test("DOIs and arXiv ids as they are pasted", () => {
  const cases: [string, ReturnType<typeof detectInput>][] = [
    ["10.1103/PhysRevLett.129.273602", { type: "doi", id: "10.1103/PhysRevLett.129.273602" }],
    ["doi:10.1103/X", { type: "doi", id: "doi:10.1103/X" }],
    [" https://doi.org/10.1103/X ", { type: "doi", id: "https://doi.org/10.1103/X" }],
    ["https://dx.doi.org/10.1103/X", { type: "doi", id: "https://dx.doi.org/10.1103/X" }],
    ["10.48550/arXiv.2207.09470", { type: "arxiv", id: "2207.09470" }],
    ["https://doi.org/10.48550/arXiv.2207.09470", { type: "arxiv", id: "2207.09470" }],
    ["2207.09470", { type: "arxiv", id: "2207.09470" }],
    ["arXiv:2207.09470v2", { type: "arxiv", id: "2207.09470" }],
    ["https://arxiv.org/abs/2207.09470v2", { type: "arxiv", id: "2207.09470" }],
    ["https://arxiv.org/pdf/2207.09470.pdf", { type: "arxiv", id: "2207.09470" }],
    ["https://arxiv.org/pdf/2207.09470v3", { type: "arxiv", id: "2207.09470" }],
    ["quant-ph/0101001", { type: "arxiv", id: "quant-ph/0101001" }],
    ["arXiv:math.GT/0309136v1", { type: "arxiv", id: "math.GT/0309136" }],
    ["https://arxiv.org/abs/hep-th/9901001", { type: "arxiv", id: "hep-th/9901001" }],
  ];
  for (const [input, expected] of cases) assert.deepEqual(detectInput(input), expected, input);
});

test("an arXiv id of before 2007 in a PDF", () => {
  const page = (str: string) => ({ width: 600, height: 800, items: [{ str, x: 50, y: 50, width: 300, height: 10 }] });
  assert.equal(identifierOf([page("arXiv:quant-ph/0101001v1 1 Jan 2001")]), "quant-ph/0101001");
});

// ---- Where an arXiv id leads ------------------------------------------------------

const ID = "2207.09470";
const S2 = `https://api.semanticscholar.org/graph/v1/paper/arXiv:${ID}`;
const ATOM = `https://export.arxiv.org/api/query?id_list=${ID}`;
const CROSSREF = `https://api.crossref.org/works/${encodeURIComponent(DOI)}`;

const json = (body: any): HttpResponse => ({ status: 200, text: JSON.stringify(body), json: body });
const status = (code: number): HttpResponse => ({ status: code, text: "", json: null });
const feed = (doi?: string): HttpResponse => ({
  status: 200,
  json: null,
  text: `<feed><title>arXiv Query</title><entry>
    <published>2022-07-19T18:00:00Z</published>
    <title>Raman photons from arXiv</title>
    <summary>The abstract on arXiv.</summary>
    <author><name>Vincenzo Macrì</name></author>
    ${doi ? `<arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">${doi}</arxiv:doi>` : ""}
  </entry></feed>`,
});
const S2_PREPRINT = json({ title: "Raman photons from Semantic Scholar", year: 2022, authors: [{ name: "Vincenzo Macrì" }], externalIds: { ArXiv: ID } });

/** Answers by address; anything else is a 404. */
function web(routes: Record<string, HttpResponse>): { http: Http; asked: string[] } {
  const asked: string[] = [];
  return { asked, http: async ({ url }) => (asked.push(url), routes[url.split("?fields=")[0]] ?? status(404)) };
}

async function fetchArxiv(routes: Record<string, HttpResponse>) {
  const { http, asked } = web(routes);
  const metadata = await new ArxivService(http).fetchByArxivId(`arXiv:${ID}v2`);
  return { metadata, asked };
}

test("Semantic Scholar names the journal DOI: the published version", async () => {
  const { metadata, asked } = await fetchArxiv({ [S2]: json({ externalIds: { DOI } }), [CROSSREF]: json({ message: WORK }) });
  assert.equal(metadata.itemType, "article");
  assert.equal(metadata.journalFull, "Physical Review Letters");
  assert.equal(metadata.arxivId, ID);
  assert.equal(asked.includes(ATOM), false, "arXiv is not asked");
});

test("Semantic Scholar refuses: the journal DOI in arXiv's record", async () => {
  const { metadata } = await fetchArxiv({ [S2]: status(429), [ATOM]: feed(DOI), [CROSSREF]: json({ message: WORK }) });
  assert.equal(metadata.itemType, "article");
  assert.equal(metadata.doi, DOI);
  assert.equal(metadata.arxivId, ID);
  assert.equal(metadata.inputType, "arxiv");
});

test("Semantic Scholar knows only the preprint: arXiv's record can still name the journal", async () => {
  const { metadata } = await fetchArxiv({ [S2]: S2_PREPRINT, [ATOM]: feed(DOI), [CROSSREF]: json({ message: WORK }) });
  assert.equal(metadata.itemType, "article");
  assert.equal(metadata.doi, DOI);
});

test("a preprint everywhere: Semantic Scholar's record, as before", async () => {
  const { metadata } = await fetchArxiv({ [S2]: S2_PREPRINT, [ATOM]: feed() });
  assert.equal(metadata.itemType, "preprint");
  assert.equal(metadata.title, "Raman photons from Semantic Scholar");
  assert.equal(metadata.doi, `10.48550/arXiv.${ID}`);
});

test("Semantic Scholar refuses and arXiv names no DOI: arXiv's preprint", async () => {
  const { metadata } = await fetchArxiv({ [S2]: status(429), [ATOM]: feed() });
  assert.equal(metadata.itemType, "preprint");
  assert.equal(metadata.title, "Raman photons from arXiv");
  assert.equal(metadata.journalFull, "arXiv");
});

test("a journal DOI that Crossref does not answer: arXiv's preprint", async () => {
  const { metadata } = await fetchArxiv({ [S2]: status(429), [ATOM]: feed(DOI) });
  assert.equal(metadata.itemType, "preprint");
  assert.equal(metadata.title, "Raman photons from arXiv");
});

test("arXiv unreachable: Semantic Scholar's preprint; both unreachable: an error", async () => {
  assert.equal((await fetchArxiv({ [S2]: S2_PREPRINT, [ATOM]: status(503) })).metadata.title, "Raman photons from Semantic Scholar");
  await assert.rejects(fetchArxiv({ [S2]: status(429), [ATOM]: status(503) }), /arXiv returned 503/);
});

test("a dx.doi.org link reaches Crossref as a bare DOI", async () => {
  const { http, asked } = web({ [CROSSREF]: json({ message: WORK }) });
  const metadata = await new CrossrefService(http).fetchByDOI(`https://dx.doi.org/${DOI}`);
  assert.equal(metadata.doi, DOI);
  assert.deepEqual(asked, [CROSSREF]);
});
