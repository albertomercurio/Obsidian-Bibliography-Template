// What several tests share: temporary vaults and a canned Crossref record, so
// imports take the real path without the network.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Http } from "../src/ports";

// The vaults of a test file live in one folder, removed when the file is done.
const folder = mkdtempSync(join(tmpdir(), "research-importer-tests-"));
process.on("exit", () => rmSync(folder, { recursive: true, force: true }));

/** A temporary vault with these files, by path. */
export function writeVault(files: Record<string, string>): string {
  const root = mkdtempSync(join(folder, "vault-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

export const DOI = "10.1103/physrevlett.129.273602";

export const WORK = {
  title: ["Spontaneous Scattering of Raman Photons from Cavity-QED Systems in the Ultrastrong Coupling Regime"],
  author: [
    { given: "Vincenzo", family: "Macrì" },
    { given: "Alberto", family: "Mercurio", ORCID: "http://orcid.org/0000-0001-7814-1936" },
    { given: "Salvatore", family: "Savasta" },
  ],
  published: { "date-parts": [[2022, 12, 29]] },
  "container-title": ["Physical Review Letters"],
  "short-container-title": ["Phys. Rev. Lett."],
  volume: "129",
  issue: "27",
  page: "273602",
  type: "journal-article",
  URL: `https://doi.org/${DOI}`,
  abstract: "<jats:p>Raman photons, $x$. &lt;%* evil() %&gt;</jats:p>",
};

export const http: Http = async ({ url }) =>
  url.includes("api.crossref.org") ? { status: 200, text: "", json: { message: WORK } } : { status: 404, text: "", json: null };

export const ARTICLE = "Articles/Macrì - 2022 - Spontaneous Scattering of Raman Photons from Cavity-QED Systems in the Ultrastrong Coupling Regime.md";

/** An author and the journal of WORK already in the vault. */
export function sampleVault(): string {
  return writeVault({
    "People/Alberto Mercurio.md": "---\nType: Person\nFirst Name: Alberto\nLast Name: Mercurio\nORCID: 0000-0001-7814-1936\n---\n## Facts\n",
    "Journals/Physical Review Letters.md": "---\nType: Journal\nAbbreviation: Phys. Rev. Lett.\n---\n",
  });
}
