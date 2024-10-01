import { Plugin } from "obsidian";
import { BMSettings, DEFAULT_BM_SETTINGS, BMSettingsTab } from "src/settings";
import { addPaletteCommands } from "src/paletteCommands";
import { addMarkdownBlockProcessors } from "src/markdownBlockProcessors";

export default class BibliographyManager extends Plugin {
	settings: BMSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new BMSettingsTab(this.app, this));

        addPaletteCommands.bind(this)();
        addMarkdownBlockProcessors.bind(this)();
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_BM_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
