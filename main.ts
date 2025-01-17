import { App, Vault, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath } from 'obsidian';

interface ReferenceEntry {
    citekey: string;
    metadata: any;
    bibtex: string;
}

const DATABASE_FILENAME = "bibliography_database.json";

export default class DOIReferencePlugin extends Plugin {
    async onload() {
        this.addCommand({
            id: "fetch-doi-metadata",
            name: "Fetch DOI Metadata",
            checkCallback: (checking: boolean) => {
                if (!checking) {
                    this.fetchAndCreateNote();
                }
                return true;
            },
        });
    }

    async fetchAndCreateNote() {
        const doi = await this.promptForDOI();
        if (!doi) return;

        try {
            const metadata = await this.fetchDOIMetadata(doi);
            const bibtex = await this.fetchDOIMetadataAsBibTeX(doi, metadata);
            
			// Format the note title: Title - FirstAuthorSurname - Year
			const safeTitle = metadata.title.replace(/[\/\\:*?"<>|]/g, ""); // Remove invalid characters
			const firstAuthorSurname = metadata.author[0]?.family || "Unknown Author";
			const year = this.getYear(metadata);
			const noteTitle = `${safeTitle} - (${year}) - ${firstAuthorSurname}`;
            const citekey = this.getCiteKey(metadata);
			const noteContent = this.generateNoteContent(metadata, bibtex, citekey);

            // Add the reference in the database
            await addReference(this.app.vault, { citekey, metadata, bibtex });

            this.createNewNote(noteTitle, noteContent, metadata);
        } catch (error) {
            new Notice("Failed to fetch DOI metadata: " + error.message);
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

    async fetchDOIMetadata(doi: string) {
        const url = `https://doi.org/${encodeURIComponent(doi)}`;
        const response = await fetch(url, {
            headers: { "Accept": "application/vnd.citationstyles.csl+json" },
        });
        if (!response.ok) {
            throw new Error(`Error: ${response.statusText}`);
        }
        return await response.json();
    }

    async fetchDOIMetadataAsBibTeX(doi: string, metadata: any): Promise<string> {
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
        const newCiteKey = this.getCiteKey(metadata);

        // Replace the old citekey with the new one
        bibtex = bibtex.replace(/(@[^{]+{)[^,]+,/, `$1${newCiteKey},`);

        return bibtex;
    }

    sanitizeString(input: string): string {
        return input
            .normalize("NFKD")                        // Remove diacritics (accents)
            .replace(/[\u0300-\u036f]/g, "")         // Further clean diacritics
            .replace(/[^a-zA-Z0-9-_]/g, "_")        // Replace invalid characters with underscore
            // .replace(/^[^a-zA-Z]+/, "")             // Ensure the key starts with a letter
            .replace(/_+/g, "_")                    // Collapse multiple underscores
            .replace(/_$/, "");                     // Remove trailing underscore
    }

    getCiteKey(metadata: any) {
        // Remove accents and spaces from author's surname
        const author = this.sanitizeString(metadata.author[0]?.family.replace(/\s+/g, '')) || "UnknownAuthor";
        const year = this.getYear(metadata);
        const title_first_word = this.sanitizeString(metadata.title.split(" ")[0]) || "UnknownTitle";
        return `${author}${year}${title_first_word}`;
    }

    getYear(metadata: any) {
        return metadata.issued["date-parts"][0][0] || "UnknownYear";
    }

    getType(metadata: any) {
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

    generateNoteContent(metadata: any, bibtex: string, citekey: string) {
        return `---
type: ${this.getType(metadata)}
cite_key: ${citekey}
title: "${metadata.title}"
authors:
${metadata.author.map((author: { given: string; family: string }) => `  - ${author.family} ${author.given}`).join("\n")}
year: ${this.getYear(metadata)}
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

    async createNewNote(noteTitle: string, content: string, metadata: any) {
        const type = this.getType(metadata);
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

// Create or ensure the database file exists
export async function ensureDatabaseFileExists(vault: Vault): Promise<TFile> {
    const filePath = normalizePath(DATABASE_FILENAME);
    const file = vault.getAbstractFileByPath(filePath);

    if (file instanceof TFile) {
        return file;
    } else {
        return await vault.create(filePath, JSON.stringify([], null, 2));
    }
}

// Load the database content
export async function loadDatabase(vault: Vault): Promise<ReferenceEntry[]> {
    const file = await ensureDatabaseFileExists(vault);
    const content = await vault.read(file);
    return JSON.parse(content);
}

// Save the database content
export async function saveDatabase(vault: Vault, data: ReferenceEntry[]): Promise<void> {
    const file = await ensureDatabaseFileExists(vault);
    await vault.modify(file, JSON.stringify(data, null, 2));
}

// Check if a reference exists by DOI
export async function referenceExists(vault: Vault, doi: string): Promise<boolean> {
    const data = await loadDatabase(vault);
    return data.some(entry => entry.metadata.DOI === doi.toLowerCase());
}

// Add a new reference
export async function addReference(vault: Vault, newEntry: ReferenceEntry): Promise<void> {
    const data = await loadDatabase(vault);
    const exists = await referenceExists(vault, newEntry.metadata.DOI);

    if (!exists) {
        // Normalize the DOI to lowercase
        newEntry.metadata.DOI = newEntry.metadata.DOI.toLowerCase();
        data.push(newEntry);
        await saveDatabase(vault, data);
    } else {
        throw new Error(`Reference with DOI ${newEntry.metadata.DOI} already exists.`);
    }
}

// Find a reference by DOI
export async function getReferenceByDOI(vault: Vault, doi: string): Promise<ReferenceEntry | undefined> {
    const data = await loadDatabase(vault);
    return data.find(entry => entry.metadata.DOI === doi.toLowerCase());
}

// Remove a reference by DOI
export async function removeReferenceByDOI(vault: Vault, doi: string): Promise<void> {
    let data = await loadDatabase(vault);
    const initialLength = data.length;
    data = data.filter(entry => entry.metadata.DOI !== doi.toLowerCase());

    if (data.length !== initialLength) {
        await saveDatabase(vault, data);
        console.log(`Reference with DOI ${doi} removed.`);
    } else {
        console.warn(`Reference with DOI ${doi} not found.`);
    }
} 
