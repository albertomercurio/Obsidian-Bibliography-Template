import BibliographyManager from "main";
import { App, Modal, Notice } from "obsidian";
import { isDoiOrUrl } from "src/utils";

class DoiInputModal extends Modal {
	doi: string;
	manager: BibliographyManager;
	onSubmit: (doi: string[]) => void = () => {};
	onCancel: () => void = () => {};
	submitted: boolean = false;
	allowMultiple: boolean;

	constructor(manager: BibliographyManager) {
		super(manager.app);
		this.manager = manager;
	}

	async onOpen() {
		const { contentEl } = this;

		const clipboard = await await navigator.clipboard.readText();
		var lines = clipboard.split("\n").filter((line) => line.length > 0);
		lines = await lines.map((line) => line.trim());
		if (this.manager.settings.readDoiFromClipboard) {
			if (this.allowMultiple) {
				this.doi = lines.every(isDoiOrUrl) ? lines.join("\n") : "";
			} else {
				this.doi =
					lines.length == 1 && isDoiOrUrl(lines[0]) ? lines[0] : "";
			}
		}

		contentEl.createEl("h1", { text: "Input the DOI or DOI url" });

		const doiInput = !this.allowMultiple
			? contentEl.createEl("input", {
					cls: "full-width",
					attr: {
						type: "text",
						placeholder: "e.g. 10.1103/PhysRevLett.43.1754",
					},
			  })
			: contentEl.createEl("textarea", {
					cls: "full-width",
					attr: {
						rows: "5",
						placeholder: "e.g. 10.1103/PhysRevLett.43.1754",
					},
			  });
		doiInput.value = this.doi;

		const submitButton = contentEl.createEl("button", {
			text: "Add entry",
			cls: "mod-cta",
			attr: {
				type: "submit",
			},
		});

		submitButton.addEventListener("click", async () => {
			let lines = doiInput.value
				.split("\n")
				.filter((line) => line.length > 0);
			lines = await lines.map((line) => line.trim());
			for (const line of lines) {
				if (!isDoiOrUrl(line)) {
					new Notice("The input doesn't look like a valid DOI.");
					return;
				}
			}

			this.submitted = true;
			this.onSubmit(lines);
			this.close();
		});

		if (!this.allowMultiple) {
			doiInput.addEventListener("keypress", (e: KeyboardEvent) => {
				if (e.key === "Enter") {
					submitButton.click();
				}
			});
		}

		doiInput.focus();
		doiInput.setSelectionRange(
			doiInput.value.length,
			doiInput.value.length
		);
	}

	onClose() {
		let { contentEl } = this;
		contentEl.empty();

		if (!this.submitted) {
			this.onCancel();
		}
	}

	async asyncOpen(multiple: boolean = false) {
		this.allowMultiple = multiple;

		return new Promise<string[]>((resolve, reject) => {
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
