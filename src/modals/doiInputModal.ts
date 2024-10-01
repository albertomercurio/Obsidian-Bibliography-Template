import BibliographyManager from "main";
import { App, Modal, Notice } from "obsidian";
import { isDoiOrUrl } from "src/utils";

class DoiInputModal extends Modal {
    doi: string;
    manager: BibliographyManager;
    onSubmit: (doi: string) => void = () => {};
    onCancel: () => void = () => {};
    submitted: boolean = false;

    constructor(manager: BibliographyManager) {
        super(manager.app);
        this.manager = manager;
    }

    async onOpen() {
        const { contentEl } = this;

        const clipboard = await navigator.clipboard.readText()
        this.doi = this.manager.settings.readDoiFromClipboard &&    isDoiOrUrl(clipboard) ? clipboard : "";

        contentEl.createEl("h1", { text: "Input the DOI or DOI url" });

        const doiInput = contentEl.createEl("input", {
            cls: "full-width",
            attr: {
                type: "text",
                value: this.doi,
                placeholder: "e.g. 10.1103/PhysRevLett.43.1754",
            },
        });

        const submitButton = contentEl.createEl("button", {
            text: "Add entry",
            cls: "mod-cta",
            attr: {
                type: "submit",
            },
        });

        submitButton.addEventListener("click", async () => {
            if (!isDoiOrUrl(doiInput.value)) {
                new Notice("The input doesn't look like a valid DOI.");
                return;
            }

            this.submitted = true;
            this.onSubmit(doiInput.value);
            this.close();
        });

        doiInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                submitButton.click();
            }
        });

        doiInput.focus();
        doiInput.setSelectionRange(doiInput.value.length, doiInput.value.length);

    }

    onClose() {
        let { contentEl } = this;
        contentEl.empty();
        
        if (!this.submitted) {
            this.onCancel();
        }
    }

    async asyncOpen() {
		return new Promise<string>((resolve, reject) => {
			this.onSubmit = (doi) => {
				resolve(doi);
			};
			this.onCancel = () => {
				reject(new Error("Modal closed with no DOI selected"));
			};
			this.open();
		});
	}
}

export { DoiInputModal };