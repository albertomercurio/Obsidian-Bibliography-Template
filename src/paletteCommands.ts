import BibliographyManager from "main";
import { DoiInputModal } from "./modals/doiInputModal";
import { BibliographyEntry, fetchEntryFromDoi } from "./entry";

async function addEntryFromDoiCallback(this: BibliographyManager) {
	let entry: BibliographyEntry;

	try {
		let doi = (await new DoiInputModal(this).asyncOpen())[0];
		entry = await fetchEntryFromDoi(doi);
	} catch (e) {
		console.warn(e);
		return;
	}

	const fileName = entry.getFileName();
	this.app.vault
		.create(
			`${this.settings.rootFolder}/${fileName}.md`,
			entry.toMarkdown()
		)
		.then((file) => {
			this.app.workspace.getLeaf("tab").openFile(file);
		});
}

async function bulkAddEntriesFromDoiCallback(this: BibliographyManager) {
	let entries: BibliographyEntry[];

	try {
		let dois = await new DoiInputModal(this).asyncOpen(true);
		entries = await Promise.all(dois.map((doi) => fetchEntryFromDoi(doi)));
	} catch (e) {
		console.warn(e);
		return;
	}

	await Promise.all(
		entries.map(async (entry) => {
			const fileName = entry.getFileName();
			this.app.vault
				.create(
					`${this.settings.rootFolder}/${fileName}.md`,
					entry.toMarkdown()
				)
				.then((file) => {
					this.app.workspace.getLeaf("tab").openFile(file);
				});
		})
	);
}

function addPaletteCommands(this: BibliographyManager) {
	const commands = [
		{
			id: "add-entry-from-doi",
			name: "Add entry from DOI",
			callback: addEntryFromDoiCallback.bind(this),
		},
		{
			id: "bulk-add-entries-from-doi",
			name: "Add multiple entries from DOIs",
			callback: bulkAddEntriesFromDoiCallback.bind(this),
		},
	];

	for (const command of commands) {
		this.addCommand(command);
	}
}

export { addPaletteCommands };
