// Titles and abstracts with MathML, as Crossref sends them: each formula on
// lines of its own, which are a space between words and nothing before a hyphen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CrossrefService } from "../src/CrossrefService";
import type { Http } from "../src/ports";

const MML = 'xmlns:mml="http://www.w3.org/1998/Math/MathML"';
const PT = `<mml:math ${MML}><mml:mi mathvariant="script">PT</mml:mi></mml:math>`;

async function record(title: string, abstract?: string) {
  const work = { title: [title], abstract, author: [], published: { "date-parts": [[2023]] }, type: "journal-article" };
  const http: Http = async () => ({ status: 200, text: "", json: { message: work } });
  return new CrossrefService(http).fetchByDOI("10.1103/test");
}

test("a formula before a hyphen: no space", async () => {
  const meta = await record(`Ratchet current in a \n${PT}\n-symmetric Floquet quantum system`);
  assert.equal(meta.title, "Ratchet current in a PT-symmetric Floquet quantum system");
  assert.equal(meta.titleLatex, "Ratchet current in a $\\mathcal{PT}$-symmetric Floquet quantum system");
});

test("a formula after a hyphen, and before punctuation: no space", async () => {
  assert.equal((await record(`Exceptional points in anti-\n${PT}\n-symmetric systems`)).titleLatex, "Exceptional points in anti-$\\mathcal{PT}$-symmetric systems");
  assert.equal((await record(`Phases of \n${PT}\n, and more`)).title, "Phases of PT, and more");
  assert.equal((await record(`Symmetry (\n${PT}\n) breaking`)).title, "Symmetry (PT) breaking");
});

test("a formula between words: the line breaks stay a space", async () => {
  // As Crossref has 10.1103/physrevb.94.024504, "Superfluid ⁴He dynamics"
  const meta = await record(
    `Superfluid\n                    <mml:math ${MML}>\n                      <mml:mmultiscripts>\n                        <mml:mi>He</mml:mi>\n                        <mml:mprescripts/>\n                        <mml:none/>\n                        <mml:mn>4</mml:mn>\n                      </mml:mmultiscripts>\n                    </mml:math>\n                    dynamics`
  );
  assert.match(meta.title, /^Superfluid \S.* dynamics$/);
  // An isotope is a prescript: mathml-to-latex 1.5 wrote "\_{}^{4}He", a visible underscore
  assert.equal(meta.titleLatex, "Superfluid ${}^{4}{He}$ dynamics");
});

test("brackets inside a formula pair up", async () => {
  const meta = await record(`<mml:math ${MML}><mml:mi>SU</mml:mi><mml:mo>(</mml:mo><mml:mn>2</mml:mn><mml:mo>)</mml:mo></mml:math> gauge theory`);
  assert.equal(meta.titleLatex, "$SU \\left(2\\right)$ gauge theory");
});

test("spaces written in the title are kept; only line breaks join", async () => {
  assert.equal((await record(`Theory of ${PT} - a review`)).title, "Theory of PT - a review");
});

test("the abstract joins the same way", async () => {
  const meta = await record("T", `<jats:p>A \n<mml:math ${MML}><mml:mi>d</mml:mi></mml:math>\n-wave state.</jats:p>`);
  assert.equal(meta.abstract, "A $d$-wave state.");
});
