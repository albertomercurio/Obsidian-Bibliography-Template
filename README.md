# Research Literature Manager

An Obsidian plugin that imports papers and books from a DOI or an arXiv ID, with linked notes for authors and journals, and a BibTeX entry you can check against its source. It needs nothing else: any vault can use it, on desktop and mobile.

## What it does

- **Import paper from DOI or arXiv ID.** Fetches the record (Crossref, Semantic Scholar, arXiv, Open Library), creates the article or book note and a note for each new author and journal. Asks before merging an author who may already exist.
- **Check the active reference against its source:** compares title, authors, journal, year, DOI and the BibTeX content, and restores them from the source if you confirm. Your notes, `Read`, `Topics` and the citation key are kept.
- **Check all references:** the same comparison on the whole vault. It offers to add what notes are missing, such as an article number in the BibTeX, and creates no notes. Where a note and its source disagree it changes nothing and lists them, because a source can be wrong too: decide one note at a time with the command above.
- **Check all references offline:** each note against its own BibTeX entry (DOI, year, title, arXiv id, authors, journal), entries missing, unreadable or left in the body, and the same work twice (DOI, arXiv id, citation key, or the same title with no link between the notes). No network, nothing changed: it lists the problems, and a click opens the note.
- **Refresh metadata for active note:** turns a preprint into its published version.
- **Re-generate BibTeX** for all articles and books.
- **Copy the BibTeX** of all references, or of those linked to the active note: the references it cites, and those naming it as author, topic or journal.

## Note format

Notes use the properties `Type`, `Title`, `Authors`, `Journal`, `Year`, `DOI`, `arXiv`, `PDF`, `Read`, `Topics` and `BibTeX` (multi-line). Authors and journals are wikilinks to their own notes, and so are publishers when the settings name a folder for them. Text from the source is in a quote callout that records where and when it was retrieved.

**Settings:** the folder of each kind of note, and an optional templates folder. With a publishers folder, a book links its publisher and a new journal links its own, found by name or alias or created as a `Publisher` note; without it, a book's publisher stays text. A file named `Article.md`, `Book.md`, `Person.md`, `Journal.md` or `Publisher.md` in the templates folder sets the properties of new notes, their order and their body. An optional log note receives an entry for each change made from the command line. Two settings are for the command line's PDFs: a PDF folder, where `add pdf=` moves the PDF of a paper, and a cover property, which links the cover cut from it.

## Command line

With Obsidian 1.12.2 or later the commands are also in Obsidian's command line, for scripts and agents; the app must be open. Commands that write show a preview and write only with `apply`:

```sh
obsidian-cli research-importer:add id=<DOI|arXiv> [arxiv=<id>] [topics="A, B"] [same="A, B"] [ask] [apply]
obsidian-cli research-importer:add pdf=<path> [id=<DOI|arXiv>] [cover] [topics=…] [same=…] [apply]   # from a PDF in the vault
obsidian-cli research-importer:cover [file=<name>|path=<path>] [apply]           # covers for references without one
obsidian-cli research-importer:check [file=<name>|path=<path>] [repair] [apply]   # repair adds what is missing
obsidian-cli research-importer:check file=<name> restore [apply]                  # overwrites one note with the source
obsidian-cli research-importer:export [file=<name>|path=<path>] > refs.bib          # prints BibTeX, writes nothing
obsidian-cli research-importer:lint [all] [format=json]                           # the offline check
```

`file=` finds a note as a wikilink does, `path=` by its exact path.

`add` answers the import's questions on its own, and lists each answer: an author with the same full name is the existing note (it only gains what it lacks, such as an ORCID); any other likely match, such as an initial for a first name, becomes a new note. Two options change that:

- `same="Vincenzo Macrì"`: these authors, named as the preview names them, are the person already in the vault. For agents: show the preview to the user, then run again with their answer.
- `ask`: the questions open in Obsidian's windows, merge included, while the command waits; ORCID name search follows the settings. `ask apply` imports as the palette does.

`add` also lists the references already in the vault that the paper cites, when Crossref has its reference list: candidates for links between them.

`pdf=` reads the DOI, or else the arXiv id, on the first pages of the PDF, unless `id=` names the paper. After the import it moves the PDF to the PDF folder of the settings, named after the citation key (`Macri2022SpontaneousScatteringRaman.pdf`, then `-2`), and adds it to `PDF`. If the paper is already in the vault, the note gains the PDF when it has none; a byte-for-byte copy of a PDF the note links goes to the trash with `apply`; another PDF stays where it is, and the output says which.

`cover`, as an option of `add` or a command of its own, cuts Figure 1 out of the PDF: the picture above the caption ("FIG. 1", "Figure 1.", "Fig. 1 |"), across the caption's width, below the nearest line of prose or the running head, without white margins. It becomes `<citation key>-cover.png` next to the PDF, linked from the cover property. A caption beside its figure, a scanned paper or a figure beyond the sixth page gives no cover, and the output says so. Without `file=`, the command covers every reference with a PDF and no cover.

`export` lists what it leaves out (no entry, a citation key already used) as `%` comments before the entries. With a log note in the settings, `add`, `cover` and `check` add what they wrote to it, with `apply`.

## Development

```sh
npm ci
npm test
VAULT=/path/to/vault npm test                          # also checks a real vault: offline check, export
npm run typecheck
npm run build                                          # dist/main.js
VAULT_PLUGIN_DIR=/path/to/plugin/folder npm run build  # also installs it there
```

`src/` is the core, with no dependency on Obsidian or Node: it talks to its host through `src/ports.ts`. `src/obsidian/` is the plugin's host; `src/node/` reads a vault from disk, for the tests and for `VAULT=… npm test`, which runs where Obsidian is not available (CI). The commands of the command line are in `src/CommandLine.ts`, and their preview in `src/StagedVault.ts`.
