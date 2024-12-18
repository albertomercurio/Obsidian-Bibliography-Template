import Dexie, { EntityTable } from "dexie";
import { Entry, entrySchemaHistory } from "./entry";
import { constants } from "../constants";
import { createFolderTree, pluginFile } from "src/utils";
import MyPlugin from "src/main";
import { getBlobArrayBuffer } from "obsidian";
import { exportDB, importInto } from "dexie-export-import";

export class BibliographyDatabase extends Dexie {
	private static instance: BibliographyDatabase;
	private plugin: MyPlugin;

	entries!: EntityTable<Entry, "id">;

	static getInstance(plugin: MyPlugin): BibliographyDatabase {
		if (!BibliographyDatabase.instance) {
			BibliographyDatabase.instance = new BibliographyDatabase(plugin);
		}
		return BibliographyDatabase.instance;
	}

	public constructor(plugin: MyPlugin) {
		super(constants.database_name, { autoOpen: false });
		this.plugin = plugin;

		for (const [version, schema] of Object.entries(entrySchemaHistory)) {
			this.version(parseInt(version)).stores({
				entries: schema,
			});
		}

		this.entries.mapToClass(Entry);
	}

	async exportDatabaseToFile() {
		const dbFile = pluginFile(this.plugin, constants.database_filename);
		const dbFolder = dbFile.split("/").slice(0, -1).join("/");

		await createFolderTree(this.plugin, dbFolder);

		const blob = await exportDB(this);
		const buffer = await getBlobArrayBuffer(blob);
		await this.plugin.app.vault.adapter.writeBinary(dbFile, buffer);
	}

	async importDatabaseFromFile() {
		const dbFile = pluginFile(this.plugin, constants.database_filename);
		if (!await this.plugin.app.vault.adapter.exists(dbFile)) return;

		const buffer = await this.plugin.app.vault.adapter.readBinary(dbFile);
		const blob = new Blob([buffer]);
		await importInto(this, blob);
	}
}
