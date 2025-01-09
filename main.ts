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
            const cleanedMetadata = this.cleanMetadata(metadata);
            
			// Format the note title: Title - FirstAuthorSurname - Year
			const safeTitle = cleanedMetadata.title.replace(/[\/\\:*?"<>|]/g, ""); // Remove invalid characters
			const firstAuthorSurname = cleanedMetadata.authors[0]?.surname || "Unknown Author";
			const year = cleanedMetadata.year || "Unknown Year";
			const noteTitle = `${safeTitle} - ${firstAuthorSurname} - ${year}`;
			const noteContent = this.generateNoteContent(cleanedMetadata);
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

    cleanMetadata(metadata: any) {
		const authors = metadata.author
			? metadata.author.map((author: { given: string; family: string }) => ({
				  name: author.given || "Unknown",
				  surname: author.family || "Unknown",
			  }))
			: [];
	
		return {
			type: metadata.type || "article",
			cite_key: `${metadata.author?.[0]?.family || "Unknown"}${metadata.issued?.["date-parts"]?.[0]?.[0] || "Unknown"}${metadata.title?.split(" ")[0] || "Unknown"}`,
			title: metadata.title || "Unknown Title",
			authors,
			year: metadata.issued?.["date-parts"]?.[0]?.[0] || "Unknown",
			publisher: metadata.publisher || "Unknown Publisher",
			journal: metadata["container-title"] || "Unknown Journal",
			url: metadata.URL || "Unknown URL",
			bibtex: this.generateBibTeX(metadata, authors),
		};
	}

    generateBibTeX(metadata: any, authors: { name: string; surname: string }[]) {
		const formattedAuthors = authors
			.map((author) => `${author.surname}, ${author.name}`)
			.join(" and ");
	
		return `@${metadata.type || "article"}{${metadata.author?.[0]?.family || "Unknown"}${metadata.issued?.["date-parts"]?.[0]?.[0] || "Unknown"}${metadata.title?.split(" ")[0] || "Unknown"},
	  title = {${metadata.title || "Unknown Title"}},
	  journal = {${metadata["container-title"] || "Unknown Journal"}},
	  year = {${metadata.issued?.["date-parts"]?.[0]?.[0] || "Unknown"}},
	  publisher = {${metadata.publisher || "Unknown Publisher"}},
	  url = {${metadata.URL || "Unknown URL"}},
	  author = {${formattedAuthors}}
	}`;
	}

    generateNoteContent(metadata: any) {
        return `---
type: ${metadata.type}
cite_key: ${metadata.cite_key}
title: ${metadata.title}
authors:
${metadata.authors.map((author: { name: string; surname: string }) => `  - ${author.surname} ${author.name}`).join("\n")}
year: ${metadata.year}
publisher: ${metadata.publisher}
journal: ${metadata.journal}
url: ${metadata.url}
bibtex: |-
  ${metadata.bibtex.split("\n").join("\n  ")}
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
