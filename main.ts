import { App, Vault, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath } from 'obsidian';

interface ReferenceEntry {
    citekey: string;
    metadata: any;
    bibtex: string;
}

const DATABASE_FILENAME = "bibliography_database.json";

export default class ObsidianBibliographyManagerPlugin extends Plugin {
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
    }

    async fetchAndCreateNote() {
        const doi = await this.promptForDOI();
        if (!doi) return;

        try {
            const metadata = await fetchDOIMetadata(doi);
            const bibtex = await fetchDOIMetadataAsBibTeX(doi, metadata);
            
			// Format the note title: Title - FirstAuthorSurname - Year
			const safeTitle = metadata.title.replace(/[\/\\:*?"<>|]/g, ""); // Remove invalid characters
			const firstAuthorSurname = metadata.author[0]?.family || "Unknown Author";
			const year = getYear(metadata);
			const noteTitle = `${safeTitle} - (${year}) - ${firstAuthorSurname}`;
            const citekey = getCiteKey(metadata);
			const noteContent = generateNoteContent(metadata, bibtex, citekey);

            // Add the reference in the database
            await this.addReference({ citekey, metadata, bibtex });

            this.createNewNote(noteTitle, noteContent, metadata);
        } catch (error) {
            new Notice("Failed to fetch DOI metadata: " + error.message);
        }
    }

    async removeOpenedReference() {
        const doi = await this.extractDOIFromActiveFile();
        if (!doi) return;
        
        try {
            await this.removeReferenceByDOI(doi);
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

    // DATABASE FUNCTIONS

    // Create or ensure the database file exists
    async ensureDatabaseFileExists(): Promise<TFile> {
        const vault = this.app.vault;
        const filePath = normalizePath(DATABASE_FILENAME);
        const file = vault.getAbstractFileByPath(filePath);

        if (file instanceof TFile) {
            return file;
        } else {
            return await vault.create(filePath, JSON.stringify([], null, 2));
        }
    }

    // Load the database content
    async loadDatabase(): Promise<ReferenceEntry[]> {
        const vault = this.app.vault;
        const file = await this.ensureDatabaseFileExists();
        const content = await vault.read(file);
        return JSON.parse(content);
    }

    // Save the database content
    async saveDatabase(data: ReferenceEntry[]): Promise<void> {
        const vault = this.app.vault;
        const file = await this.ensureDatabaseFileExists();
        await vault.modify(file, JSON.stringify(data, null, 2));
    }

    // Check if a reference exists by DOI
    async referenceExists(doi: string): Promise<boolean> {
        const data = await this.loadDatabase();
        return data.some(entry => entry.metadata.DOI === doi.toLowerCase());
    }

    // Add a new reference
    async addReference(newEntry: ReferenceEntry): Promise<void> {
        const data = await this.loadDatabase();
        const exists = await this.referenceExists(newEntry.metadata.DOI);

        if (!exists) {
            // Normalize the DOI to lowercase
            newEntry.metadata.DOI = newEntry.metadata.DOI.toLowerCase();
            data.push(newEntry);
            await this.saveDatabase(data);
        } else {
            throw new Error(`Reference with DOI ${newEntry.metadata.DOI} already exists.`);
        }
    }

    // Find a reference by DOI
    async getReferenceByDOI(doi: string): Promise<ReferenceEntry | undefined> {
        const data = await this.loadDatabase();
        return data.find(entry => entry.metadata.DOI === doi.toLowerCase());
    }

    // Remove a reference by DOI
    async removeReferenceByDOI(doi: string): Promise<void> {
        let data = await this.loadDatabase();
        const initialLength = data.length;
        data = data.filter(entry => entry.metadata.DOI !== doi.toLowerCase());

        if (data.length !== initialLength) {
            await this.saveDatabase(data);
            console.log(`Reference with DOI ${doi} removed.`);
        } else {
            console.warn(`Reference with DOI ${doi} not found.`);
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
        const folderPath = type === "article" ? "Research/Bibliography/Articles" : "Research/Bibliography/Books";
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

class InputDOIModal extends Modal {
    private callback: (value: string) => void;
    private placeholder: string;

    constructor(app: App, placeholder: string, callback: (value: string) => void) {
        super(app);
        this.placeholder = placeholder;
        this.callback = callback;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: this.placeholder });
    
        const container = contentEl.createEl("div", { cls: "doi-container" });
        container.style.display = "flex";
        container.style.flexDirection = "column";
        container.style.alignItems = "center";
        container.style.justifyContent = "center";
        container.style.width = "100%";
        container.style.padding = "20px";
        container.style.boxSizing = "border-box";
    
        const input = container.createEl("input", { type: "text" });
        input.style.width = "100%";
        input.style.marginBottom = "10px";
        input.style.padding = "10px";
        input.style.border = "1px solid #ccc";
        input.style.borderRadius = "4px";
        input.focus();
    
        const submitButton = container.createEl("button", { text: "Submit" });
        // submitButton.style.backgroundColor = "#007bff";
        // submitButton.style.color = "#fff";
        submitButton.style.border = "none";
        submitButton.style.padding = "10px 20px";
        submitButton.style.borderRadius = "4px";
        submitButton.style.cursor = "pointer";
        submitButton.onclick = () => {
            this.callback(input.value.trim());
            this.close();
        };
    
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                this.callback(input.value.trim());
                this.close();
            }
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
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
    return await response.json();
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
    const author = sanitizeString(metadata.author[0]?.family.replace(/\s+/g, '')) || "UnknownAuthor";
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
        // Add more mappings as needed
    };

    const type = typeMapping[metadata.type] || "article";

    return type;
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
