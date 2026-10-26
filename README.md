# Research Literature Manager — Obsidian Plugin

A custom Obsidian plugin that imports academic papers from a DOI or arXiv ID and automatically creates linked notes for articles, authors, journals, and books — all integrated with your vault's structure and Obsidian Bases.

---

## Features

- **One-step import**: paste a DOI or arXiv ID → the plugin fetches full metadata from [Crossref](https://crossref.org) and [Semantic Scholar](https://semanticscholar.org), creates an Article note, linked author notes, and a Journal note.
- **BibTeX generation**: produces a properly formatted BibTeX entry with cite key `SurnameYEARFirstWords`, journal abbreviation, and LaTeX-encoded author names.
- **Deduplication**: checks DOI and arXiv ID against the vault before creating anything; prompts you when an author or journal might already exist.
- **ORCID enrichment**: uses the [ORCID public API](https://pub.orcid.org) to find and attach ORCIDs to authors.
- **Large-collaboration safeguard**: if a paper exceeds the configured author limit, the plugin warns before import and, if you continue, keeps only the first author in Obsidian while preserving the full BibTeX author list.
- **Obsidian Bases ready**: notes use typed frontmatter properties that the vault's `Articles.base`, `People.base` and `Journals.base` views read.
- **Retroactive BibTeX**: a command to re-generate the BibTeX entry of all existing Article and Book notes if you change the format. Volume, issue, pages and the full author list of large collaborations are kept from the existing entry; family names come from the Person notes.

---

## Note format

The plugin writes the note layout of the Second Brain vault (property names and bodies are defined in `src/schema.ts`):

- **Article / Book** (`library/articles/Surname - YEAR - Title.md`): `Type`, `Title`, `Authors`, `Journal`, `Year`, `DOI`, `arXiv`, `PDF`, `Read`, `Topics`; `URL` only when there is no DOI. The abstract goes in a `> [!quote]` callout; the BibTeX entry goes in the `## BibTeX` section, below a `> [!info] Source: Crossref · DOI … · retrieved YYYY-MM-DD` line that marks it as checked against the source.
- **Person** (`notes/people/First Last.md`): `First Name`, `Last Name`, `ORCID`, `Email`, `Affiliations`, `Relationship: [Author]` (an author is not automatically a collaborator), plus a `## Sources` line saying which record created it.
- **Journal** (`library/journals/Full Name.md`): `Abbreviation`, used in the BibTeX `journal` field.

Citation keys follow `SurnameYEARFirstWords` (`Macri2022SpontaneousScatteringRaman`), unchanged from earlier versions.

## Repository structure

```
.
├── main.ts                   # Plugin entry point (Obsidian convention: always at root)
├── src/
│   ├── types.ts              # Shared TypeScript interfaces (PaperMetadata, PluginSettings, …)
│   ├── schema.ts             # Property names, note bodies, BibTeX/abstract sections (no Obsidian imports)
│   ├── settings.ts           # Settings tab UI
│   ├── CrossrefService.ts    # Fetch metadata by DOI via Crossref API
│   ├── ArxivService.ts       # Fetch metadata by arXiv ID (Semantic Scholar + arXiv fallback)
│   ├── OrcidService.ts       # Search and fetch ORCID public records
│   ├── BibtexGenerator.ts    # Generate BibTeX strings with LaTeX encoding
│   ├── VaultIndex.ts         # In-memory index of People/Journals/DOIs built from MetadataCache
│   ├── NoteCreator.ts        # Create Article / Book / Person / Journal notes in the vault
│   ├── ImportModal.ts        # Modal: input DOI or arXiv ID
│   ├── DisambiguationModal.ts # Modal: compare incoming vs vault entity, ask user
│   ├── AuthorOverflowModal.ts # Modal: confirm import when a paper has many authors
│   └── ImportService.ts      # Orchestrate the full import flow
├── tests/                    # Unit tests (node:test) and fixtures shared with the Second Brain tools
├── styles.css                # Modal CSS
├── manifest.json             # Obsidian plugin manifest
├── package.json
├── tsconfig.json
└── esbuild.config.mjs        # Build script (also copies output to the vault)
```

---

## One-time vault setup

1. **Enable the plugin**: Settings → Community Plugins → *Research Literature Manager* → toggle on.
2. **Check the folders** (Settings → Research Literature Manager): defaults are `library/articles`, `library/books`, `notes/people`, `library/journals`.
3. **Review the author limit**: by default, imports with more than `25` authors ask for confirmation. If you continue, only the first author is linked in Obsidian metadata, while BibTeX keeps the full author list.

Note bodies are built into the plugin, so no template notes are needed.

## Usage

### Import a paper

- Click the **book icon** in the ribbon, *or*
- Open the command palette (`Cmd+P`) → **"Import paper from DOI or arXiv ID"**

Paste a DOI (e.g. `10.1103/PhysRevLett.130.033605`) or an arXiv ID (e.g. `2301.12345`) and press **Import** or Enter.

The plugin will:
1. Fetch metadata from Crossref (for DOIs) or Semantic Scholar / arXiv (for arXiv IDs).
2. Check whether the paper already exists in your vault by DOI / arXiv ID.
3. If the paper has more authors than your configured maximum, the plugin asks whether to continue. Continuing keeps the full BibTeX author list but only links the first author in Obsidian metadata.
4. Resolve each visible author: exact match → reuse; partial match or ORCID candidate → show a disambiguation modal asking *"Same person?"*.
5. Resolve the journal: exact match by full name or alias → reuse; new journal → create a Journal note.
6. Generate a BibTeX entry and create the Article (or Book) note at `Articles/Surname - YEAR - Title.md`.

### Re-generate BibTeX

Command palette → **"Re-generate BibTeX for all articles and books"**.  
Useful if you change the cite-key format or LaTeX encoding in `BibtexGenerator.ts`. Only the BibTeX entry in the `## BibTeX` section is updated (volume, pages and the full author list are kept); the source line and everything else are preserved.

---

## Development workflow

### Prerequisites

- [Node.js](https://nodejs.org) ≥ 18
- This repo cloned to a path **outside** the iCloud vault (to avoid syncing `node_modules`)

### Install dependencies (first time only)

```bash
cd /path/to/Obsidian-Bibliography-Template
npm install
```

### Point the build at your vault (first time only)

The build can install itself into your vault automatically. Tell it where by creating a
`.vault-path` file in the repo root containing the absolute path to the plugin folder inside your
vault:

```bash
echo "/path/to/Your Vault/.obsidian/plugins/research-importer" > .vault-path
```

- `.vault-path` is **gitignored**, so your personal path never gets committed and this repo stays shareable.
- Alternatively, set the `VAULT_PLUGIN_DIR` environment variable (it takes priority over the file).
- If neither is set, `npm run build` still produces `main.js` but prints a notice and skips the vault copy — copy `main.js`, `manifest.json`, and `styles.css` over manually.

### Make a change and update the plugin

1. Edit any `.ts` file in `src/` or `main.ts`.
2. Run the build:
   ```bash
   npm run build
   ```
   This compiles TypeScript, bundles everything into `main.js`, and (when `.vault-path` /
   `VAULT_PLUGIN_DIR` is set) **automatically copies** `main.js`, `manifest.json`, and `styles.css`
   to the vault's plugin folder:
   ```
   …/Your Vault/.obsidian/plugins/research-importer/
   ```
3. In Obsidian, reload the plugin:
   - Command palette → **"Reload app without saving"**, *or*
   - Settings → Community Plugins → toggle the plugin off and on again.

> **Tip – watch mode**: run `npm run dev` for incremental rebuilds on every file save. You still need to reload the plugin in Obsidian to pick up the changes.

### Tests

```bash
npm test          # bundles tests/*.test.ts with esbuild and runs node --test
npm run typecheck
```

`tests/fixtures/second-brain-expected.json` holds the values the Second Brain command-line importer (`sb lit add`) produces for the same papers: the plugin must produce the same citation keys and fields.

### Install into a vault

```bash
VAULT_PLUGIN_DIR="/path/to/Vault/.obsidian/plugins/research-importer" npm run install-plugin
```

The script refuses to run without `VAULT_PLUGIN_DIR`, so no personal path lives in the repository.

### Commit your changes

```bash
cd /path/to/Obsidian-Bibliography-Template
git add -A
git commit -m "describe your change"
```

The compiled `main.js` is in `.gitignore` — only source files are tracked.

---

## APIs used

| Source | Endpoint | Auth |
|--------|----------|------|
| Crossref | `https://api.crossref.org/works/{doi}` | None (polite pool via User-Agent) |
| Semantic Scholar | `https://api.semanticscholar.org/graph/v1/paper/arXiv:{id}` | None |
| arXiv | `https://export.arxiv.org/api/query?id_list={id}` | None |
| ORCID (search) | `https://pub.orcid.org/v3.0/search/` | None (public API) |
| ORCID (record) | `https://pub.orcid.org/v3.0/{orcid}/person` | None (public records only) |

---
