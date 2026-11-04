# Research Literature Manager

An Obsidian plugin that imports papers and books from a DOI or an arXiv ID, with linked notes for authors and journals, and a BibTeX entry you can check against its source. It needs nothing else: any vault can use it, on desktop and mobile.

## What it does

- **Import paper from DOI or arXiv ID.** Fetches the record (Crossref, Semantic Scholar, arXiv, Open Library), creates the article or book note and a note for each new author and journal. Asks before merging an author who may already exist.
- **Check the active reference against its source**, and **check all references**: compares title, authors, journal, year, DOI and the BibTeX content, and restores them from the source if you confirm. Your notes, `Read`, `Topics` and the citation key are kept.
- **Refresh metadata for active note:** turns a preprint into its published version.
- **Re-generate BibTeX** for all articles and books.
- **Copy the BibTeX** of all references, or of those linked to the active note: the references it cites, and those naming it as author, topic or journal.

## Note format

Notes use the properties `Type`, `Title`, `Authors`, `Journal`, `Year`, `DOI`, `arXiv`, `PDF`, `Read`, `Topics` and `BibTeX` (multi-line). Authors and journals are wikilinks to their own notes. Text from the source is in a quote callout that records where and when it was retrieved.

**Settings:** the folder of each kind of note, and an optional templates folder. A file named `Article.md`, `Book.md`, `Person.md` or `Journal.md` in it sets the properties of new notes, their order and their body.

## Command line

The same code runs on the files of a vault, without Obsidian, for scripts and agents. Commands show a preview and write only with `--apply`:

```sh
node cli.mjs add <DOI|arXiv> [--topic Name]... [--arxiv ID] [--apply] [--vault DIR] [--log FILE]
node cli.mjs check [note]... [--repair] [--apply] [--vault DIR] [--log FILE]
node cli.mjs export [note] [--vault DIR]    # prints BibTeX, writes nothing
```

## Development

```sh
npm ci
npm test
npm run typecheck
npm run build                                        # dist/main.js and dist/cli.mjs
VAULT_PLUGIN_DIR=/path/to/plugin/folder npm run build  # also installs them there
```

`src/` is the core, with no dependency on Obsidian or Node: it talks to its host through `src/ports.ts`. `src/obsidian/` and `src/node/` are the two hosts.
