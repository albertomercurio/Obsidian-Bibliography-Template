import MyPlugin from "src/main";
import { BibliographyDatabase } from "./bibliographyDatabase";

export class DatabaseManager {
	private static instance: DatabaseManager;
	private plugin: MyPlugin;
	db: BibliographyDatabase;

	static getInstance(plugin: MyPlugin): DatabaseManager {
		if (!DatabaseManager.instance) {
			DatabaseManager.instance = new DatabaseManager(plugin);
		}
		return DatabaseManager.instance;
	}

	private constructor(plugin: MyPlugin) {
		this.plugin = plugin;
		this.db = BibliographyDatabase.getInstance(this.plugin);
	}

	async openDb() {
		await this.db.open();
		await this.db.importDatabaseFromFile();
	}

	async closeDb() {
		await this.db.exportDatabaseToFile();
		await this.db.delete();
	}

	async getAllEntries() {
		return this.db.entries.toCollection()
	}
}
