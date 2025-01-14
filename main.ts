import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

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
            this.createNewNote(noteTitle, noteContent);
        } catch (error) {
            new Notice("Failed to fetch DOI metadata: " + error.message);
        }
    }

    async promptForDOI(): Promise<string | null> {
        return new Promise((resolve) => {
            const modal = new InputModal(this.app, "Enter DOI", (doi) => {
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
        bibtex = bibtex.replace(/@[^{]+{[^,]+,/, (match) => match.replace(/[^,{]+/, newCiteKey));

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

    generateNoteContent(metadata: any, bibtex: string) {
        return `---
type: ${metadata.type}
cite_key: ${this.getCiteKey(metadata)}
title: ${metadata.title}
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
`;
    }

    async createNewNote(noteTitle: string, content: string) {
        const filePath = `${noteTitle}.md`;
        await this.app.vault.create(filePath, content);
        new Notice(`Note created: ${filePath}`);
    }
}

class InputModal extends Modal {
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

        const input = contentEl.createEl("input", { type: "text" });
        input.focus();

        const submitButton = contentEl.createEl("button", { text: "Submit" });
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
