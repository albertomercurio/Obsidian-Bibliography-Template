# Research Literature Manager — Obsidian Plugin

A custom Obsidian plugin that imports academic papers from a DOI or arXiv ID and automatically creates linked notes for articles, authors, journals, and books — all integrated with your vault's structure and Obsidian Bases.

---

## Features

- **One-step import**: paste a DOI or arXiv ID → the plugin fetches full metadata from [Crossref](https://crossref.org) and [Semantic Scholar](https://semanticscholar.org), creates an Article note, linked author notes, and a Journal note.
- **BibTeX generation**: produces a properly formatted BibTeX entry with cite key `SurnameYEARFirstWords`, journal abbreviation, and LaTeX-encoded author names.
- **Deduplication**: checks DOI and arXiv ID against the vault before creating anything; prompts you when an author or journal might already exist.
- **ORCID enrichment**: uses the [ORCID public API](https://pub.orcid.org) to find and attach ORCIDs to authors.
- **Large-collaboration safeguard**: if a paper exceeds the configured author limit, the plugin warns before import and, if you continue, keeps only the first author in Obsidian while preserving the full BibTeX author list.
- **Obsidian Bases ready**: Article, Book, Journal notes use typed frontmatter properties compatible with `Articles.base`, `Books.base`, `Journals.base`.
- **Retroactive BibTeX**: a command to re-generate the BibTeX entry of all existing Article and Book notes if you change the format. Volume, issue, pages and the full author list of large collaborations are kept from the existing entry; family names come from the Person notes.
- **Schema profiles**: the same importer writes into vaults with different property names (see below).

---

## Schema profiles

Settings → Research Literature Manager → **Note schema** selects how notes are written. Switching profile also moves the folder settings to the new defaults, unless you had changed them.

| | Legacy (default) | Second Brain 0.3 |
| --- | --- | --- |
| Properties | `type`, `title`, `authors`, `arxiv_id`, `first_name`, `ORCiD`, … | `Type`, `Title`, `Authors`, `arXiv`, `First Name`, `ORCID`, … |
| BibTeX | `bibtex` frontmatter property | `## BibTeX` section of the note, below a `> [!info] Source: Crossref · DOI … · retrieved YYYY-MM-DD` line |
| Abstract | Inserted under the template's `## Abstract` heading | `> [!quote]` callout under `## Abstract` |
| New authors | `first_name`, `last_name`, `ORCiD` | Same in Title Case, plus `Relationship: [Author]` and a `## Sources` line |
| Journals | `full_name`, abbreviation in `aliases` | `Abbreviation` property (used in BibTeX) |
| BibTeX style | `url` always, `eprint` only for preprints | No `url` when a DOI exists; `eprint` also for published articles with an arXiv id |
| Note bodies | Read from the vault's `* Template` notes | Built in, matching the Second Brain schema |
| Folders | `Articles`, `Books`, `People`, `Journals` | `library/articles`, `library/books`, `notes/people`, `library/journals` |

Profiles live in `src/schema.ts`. Citation keys (`Macri2022SpontaneousScatteringRaman`) are the same in both, so existing citations keep working.

## Repository structure

```
.
├── main.ts                   # Plugin entry point (Obsidian convention: always at root)
├── src/
│   ├── types.ts              # Shared TypeScript interfaces (PaperMetadata, PluginSettings, …)
│   ├── schema.ts             # Schema profiles and note-body helpers (no Obsidian imports)
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

After enabling the plugin in Obsidian, do this once:

1. **Enable the plugin**: Settings → Community Plugins → find *Research Literature Manager* → toggle on.
2. **Configure Templater folder templates** (Settings → Templater → Folder Templates):

   | Folder | Template |
   |--------|----------|
   | `Articles/` | `Article Template` |
   | `Books/` | `Book Template` |
   | `People/` | `Person Template` |
   | `Journals/` | `Journal Template` |

   This ensures that if you click an unresolved wikilink and create a note manually, it lands in the right folder with the right layout.

3. **Check plugin settings** (Settings → Research Literature Manager): folder paths default to `Articles`, `Books`, `People`, `Journals` — adjust if your vault uses different names.
4. **Review the author limit**: by default, imports with more than `25` authors ask for confirmation. If you continue, only the first author is linked in Obsidian metadata, while BibTeX still keeps the full author list.

---

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
Useful if you change the cite-key format or LaTeX encoding in `BibtexGenerator.ts`. Only the `bibtex` frontmatter field is updated; everything else is preserved.

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

## Note format

### Article (`Articles/Surname - YEAR - Title.md`)

```yaml
---
type: Article
doi: "10.xxxx/…"
arxiv_id: "2301.xxxxx"
title: "Full paper title"
authors:
  - "[[First Last]]"
  - "[[First Last]]"
journal: "[[Physical Review Letters]]"
year: 2024
url: "https://…"
pdf:
read: false
bibtex: "@article{Surname2024Word,\n  …\n}"
tags:
---
```

### Journal (`Journals/Full Name.md`)

```yaml
---
type: Journal
full_name: "Physical Review Letters"
aliases:
  - "Phys. Rev. Lett."
  - "PRL"
tags:
---
```

The `aliases` field is native Obsidian — `[[Phys. Rev. Lett.]]` in any note automatically resolves to the Journal file.

### Person (`People/First Last.md`)

```yaml
---
type: Person
first_name: "Alberto"
last_name: "Mercurio"
ORCiD: "0000-0001-2345-6789"
e-mail:
cover_image:
tags:
---
```
