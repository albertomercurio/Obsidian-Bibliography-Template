import { Plugin } from "obsidian";
import { DatabaseManager } from "./database/databaseManager";

export default class MyPlugin extends Plugin {
	dm: DatabaseManager;

	async onload() {
		console.clear();

		// Load or create the database
		this.dm = DatabaseManager.getInstance(this);
		await this.dm.openDb();
	}

	async onunload() {
		await this.dm.closeDb();
	}
}
