import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';

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
			const noteTitle = `${safeTitle} - ${firstAuthorSurname} - ${year}`;
			const noteContent = this.generateNoteContent(metadata, bibtex);
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
        // Format BibTeX: Add line breaks after each field
        bibtex = bibtex.replace(/,(?=\s*\w+\s*=)/g, ',\n  ');
        // Generate the new citekey
        const newCiteKey = this.getCiteKey(metadata);

        // Replace the old citekey with the new one
        // Replace the old citekey with the new one
        bibtex = bibtex.replace(/(@[^{]+{)[^,]+,/, `$1${newCiteKey},`);

        return bibtex;
    }

    getCiteKey(metadata: any) {
        // Remove accents and spaces from author's surname
        const author = metadata.author[0]?.family.replace(/\s+/g, '').normalize("NFD").replace(/[\u0300-\u036f]/g, "") || "UnknownAuthor";
        const year = this.getYear(metadata);
        const title_first_word = metadata.title.split(" ")[0] || "UnknownTitle";
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

    generateNoteContent(metadata: any, bibtex: string) {
        return `---
type: ${this.getType(metadata)}
cite_key: ${this.getCiteKey(metadata)}
title: "${metadata.title}"
authors:
${metadata.author.map((author: { given: string; family: string }) => `  - ${author.family} ${author.given}`).join("\n")}
year: ${this.getYear(metadata)}
publisher: ${metadata.publisher}
journal: ${metadata["container-title"]}
doi: ${metadata.DOI}
url: ${metadata.URL}
bibtex: |-
  ${bibtex}
tags:
  - bibliography
---

## Attachments

- PDF:
- Supplemental:

## Tasks
- [ ] Add PDF 🔽

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
