import { Plugin } from "obsidian";
import { DatabaseManager } from "./database/databaseManager";
import { BibliographyListView } from "./views/bibliographyListView";
import { constants } from "./constants";

export default class MyPlugin extends Plugin {
	dm: DatabaseManager;

	async onload() {
		console.clear();

		// Load or create the database
		this.dm = DatabaseManager.getInstance(this);
		await this.dm.openDb();

		this.setupViews();

		this.setupCommands();
	}

	async onunload() {
		await this.dm.closeDb();
	}

	setupViews() {
		this.registerView(
			constants.bibliography_list_view_type,
			(leaf) => new BibliographyListView(leaf, this)
		)
	}

	setupCommands() {
		this.addCommand({
			id: constants.bibliography_list_command_id,
			name: constants.bibliography_list_command_name,
			callback: async () => {
				const leaf = this.app.workspace.getLeaf(false)
				await leaf.setViewState({
					type: constants.bibliography_list_view_type,
					active: true
				})
				this.app.workspace.revealLeaf(leaf);
			}
		})
	}
}
