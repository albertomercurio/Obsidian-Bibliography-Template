import { Notice, Plugin, TFile, normalizePath } from 'obsidian';
import { InputDOIModal, MetadataUpdateModal } from './modal';
import { BibliographyDatabase } from './database';

export default class ObsidianBibliographyManagerPlugin extends Plugin {
    bibliography: BibliographyDatabase = new BibliographyDatabase(this);

    async onload() {
        this.addCommand({
            id: "add-reference-from-doi",
            name: "Add Reference from DOI",
            checkCallback: (checking: boolean) => {
                if (!checking) {
                    this.fetchAndCreateNote();
                }
                return true;
            },
        });

        this.addCommand({
            id: "remove-opened-reference",
            name: "Remove Opened Reference",
            checkCallback: (checking: boolean) => {
                if (!checking) {
                    this.removeOpenedReference();
                }
                return true;
            },
        });

        this.addCommand({
            id: 'update-reference-metadata',
            name: 'Update Current Reference Metadata',
            callback: () => {
                new MetadataUpdateModal(this.app, async (field, value) => {
                    await this.updateMetadata(field, value);
                }).open();
            }
        });
    }

    async fetchAndCreateNote() {
        const doi = await this.promptForDOI();
        if (!doi) return;

        try {
            const metadata = await fetchDOIMetadata(doi);
            const bibtex = await fetchDOIMetadataAsBibTeX(doi, metadata);

            // Format the note title: Title - FirstAuthorSurname - Year
            const safeTitle = metadata.title.replace(/[\/\\:*?"<>|]/g, ""); // Remove invalid characters
            const firstAuthorSurname = metadata.author[0].family;
            const year = getYear(metadata);
            const noteTitle = `${safeTitle} - (${year}) - ${firstAuthorSurname}`;
            const citekey = getCiteKey(metadata);
            const noteContent = generateNoteContent(metadata, bibtex, citekey);

            // Add the reference in the database
            await this.bibliography.addReference({ citekey, metadata, bibtex });

            this.createNewNote(noteTitle, noteContent, metadata);
        } catch (error) {
            new Notice("Failed to fetch DOI metadata: " + error.message);
        }
    }

    async removeOpenedReference() {
        const doi = await this.extractDOIFromActiveFile();
        if (!doi) return;

        try {
            await this.bibliography.removeReferenceByDOI(doi);
            new Notice("Reference removed successfully.");
        } catch (error) {
            new Notice("Failed to remove reference: " + error.message);
        }

        await this.deleteActiveFile();
    }

    // Function to delete the currently active file
    async deleteActiveFile() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice("No active file found.");
            return;
        }

        try {
            await this.app.vault.delete(activeFile);
            new Notice("File deleted successfully.");
        } catch (error) {
            new Notice("Failed to delete file: " + error.message);
        }
    }

    async extractDOIFromActiveFile() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice("No active file found.");
            return;
        }

        const fileCache = this.app.metadataCache.getFileCache(activeFile);
        if (!fileCache || !fileCache.frontmatter) {
            new Notice("No front matter found in the active file.");
            return;
        }

        const doi = fileCache.frontmatter.doi;
        if (!doi) {
            new Notice("No DOI found in the front matter of the active file.");
            return;
        }

        return doi;
    }

    async updateMetadata(field: string, value: string) {
        // const data = await this.bibliography.loadDatabase();
        // const reference = data.find(entry => entry.filePath === file.path);
        const doi = await this.extractDOIFromActiveFile();
        const data = await this.bibliography.loadDatabase();
        const reference = data.find(entry => entry.metadata.DOI === doi);

        if (reference) {
            if (field === "author") {
                try {
                    // Attempt to parse the value as JSON
                    const parsedValue = JSON.parse(value);
                    reference.metadata[field] = parsedValue;
                } catch (error) {
                    new Notice(`Failed to parse value as JSON. Storing it as a string. Error: ${error.message}`);
                    reference.metadata[field] = value;
                }
            } else {
                reference.metadata[field] = value;
            }

            await this.bibliography.saveDatabase(data);
            //   await this.updateNoteFrontmatter(file, field, value);
            new Notice(`Metadata field "${field}" updated successfully.`);
        } else {
            new Notice(`Reference with DOI ${doi} not found in the database.`);
        }
    }

    async promptForDOI(): Promise<string | null> {
        return new Promise((resolve) => {
            const modal = new InputDOIModal(this.app, "Enter DOI", (doi) => {
                resolve(doi || null);
            });
            modal.open();
        });
    }

    async createNewNote(noteTitle: string, content: string, metadata: any) {
        const type = getType(metadata);
        const folderPath = getTypeFolder(type);
        const filePath = `${folderPath}/${noteTitle}.md`;
        await this.app.vault.create(filePath, content);
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            await this.app.workspace.getLeaf(true).openFile(file);
        } else {
            new Notice("Failed to open the newly created note.");
        }
    }
}

async function fetchDOIMetadata(doi: string) {
    const url = `https://doi.org/${encodeURIComponent(doi)}`;
    const response = await fetch(url, {
        headers: { "Accept": "application/vnd.citationstyles.csl+json" },
    });
    if (!response.ok) {
        throw new Error(`Error: ${response.statusText}`);
    }
    const metadata = await response.json();
    if (!metadata.author) {
        new Notice("No author found in the metadata. Please add an author to the note manually.");
        metadata.author = [{ family: "Unknown", given: "Author" }];
    }
    return metadata;
}

async function fetchDOIMetadataAsBibTeX(doi: string, metadata: any): Promise<string> {
    const url = `https://doi.org/${encodeURIComponent(doi)}`;
    const response = await fetch(url, {
        headers: { "Accept": "application/x-bibtex" },
    });
    if (!response.ok) {
        throw new Error(`Error: ${response.statusText}`);
    }
    let bibtex = await response.text();

    // Remove any whitespace at the beginning of the BibTeX string
    bibtex = bibtex.replace(/^\s+/, '');
    // Remove all existing line breaks and extra spaces
    bibtex = bibtex.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ');
    // Format BibTeX: Add line breaks after each field with consistent indentation
    bibtex = bibtex.replace(/\s*,\s*(?=\w+\s*=)/g, ',\n  ');

    // Generate the new citekey
    const newCiteKey = getCiteKey(metadata);

    // Replace the old citekey with the new one
    bibtex = bibtex.replace(/(@[^{]+{)[^,]+,/, `$1${newCiteKey},`);

    return bibtex;
}

function sanitizeString(input: string): string {
    return input
        .normalize("NFKD")                        // Remove diacritics (accents)
        .replace(/[\u0300-\u036f]/g, "")         // Further clean diacritics
        .replace(/[^a-zA-Z0-9-_]/g, "_")        // Replace invalid characters with underscore
        // .replace(/^[^a-zA-Z]+/, "")             // Ensure the key starts with a letter
        .replace(/_+/g, "_")                    // Collapse multiple underscores
        .replace(/-+/g, "_")                   // Replace hyphens with underscores
        .replace(/_$/, "");                     // Remove trailing underscore
}

function getCiteKey(metadata: any) {
    // Remove accents and spaces from author's surname
    const author = sanitizeString(metadata.author[0].family.replace(/\s+/g, ''));
    const year = getYear(metadata);
    const title_first_word = sanitizeString(metadata.title.split(" ")[0]) || "UnknownTitle";
    return `${author}${year}${title_first_word}`;
}

function getYear(metadata: any) {
    return metadata.issued["date-parts"][0][0] || "UnknownYear";
}

function getType(metadata: any) {
    // Define a mapping from the type field to BibTeX entry types
    const typeMapping: { [key: string]: string } = {
        "journal-article": "article",
        "book": "book",
        "book-chapter": "inbook",
        "monograph": "book", // Map non-standard 'monograph' to 'book'
        // Add more mappings as needed
    };

    const type = typeMapping[metadata.type] || "misc";

    return type;
}

function getTypeFolder(type: string) {
    // Define a mapping from the type field to BibTeX entry types
    const typeMapping: { [key: string]: string } = {
        "article": normalizePath("Research/Bibliography/Articles"),
        "book": normalizePath("Research/Bibliography/Books"),
        "book-chapter": normalizePath("Research/Bibliography/Books"),
        "monograph": normalizePath("Research/Bibliography/Books"), // Map non-standard 'monograph' to 'book'
        // Add more mappings as needed
    };

    return typeMapping[type] || normalizePath("Research/Bibliography");
}

function generateNoteContent(metadata: any, bibtex: string, citekey: string) {
    return `---
type: ${getType(metadata)}
cite_key: ${citekey}
title: "${metadata.title}"
authors:
${metadata.author.map((author: { given: string; family: string }) => `  - ${author.family} ${author.given}`).join("\n")}
year: ${getYear(metadata)}
publisher: "${metadata.publisher}"
journal: "${metadata["container-title"]}"
doi: ${metadata.DOI}
url: ${metadata.URL}
bibtex: |-
  ${bibtex}
has_attachments: false
tags:
  - bibliography
---

## Attachments

- PDF: 
- Supplemental: 

## Comments
`;
}
