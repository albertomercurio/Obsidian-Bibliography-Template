import BibliographyManager from "main";
import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { getCompactRelativePath, isValidRelativePath } from "./utils";

interface BMSettings {
	rootFolder: string;
	readDoiFromClipboard: boolean;
}

const DEFAULT_BM_SETTINGS: Partial<BMSettings> = {
	rootFolder: "Bibliography",
	readDoiFromClipboard: true,
};

class BMSettingsTab extends PluginSettingTab {
	plugin: BibliographyManager;

	constructor(app: App, plugin: BibliographyManager) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		let rootFolderInput: HTMLInputElement;

		new Setting(containerEl)
			.setName("Root folder")
			.setDesc(
				"The folder where the bibliography is stored (relative to the vault root). If the folder does not exist, it will be created."
			)
			.addText((text) => {
				rootFolderInput = text
					.setPlaceholder("Bibliography root folder")
					.setValue(this.plugin.settings.rootFolder).inputEl;
			})
			.addButton((button) => {
				button.setButtonText("Save").onClick(async () => {
					await this.saveRootFolder(rootFolderInput);
				});
			});

		new Setting(containerEl)
			.setName("Read DOI from clipboard")
			.setDesc("Populate the DOI input field with the clipboard content, if valid.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.readDoiFromClipboard)
				.onChange(async (value) => {
					this.plugin.settings.readDoiFromClipboard = value;
					await this.plugin.saveSettings();
				});
			});
	}

	saveRootFolder = async (rootFolderInput: HTMLInputElement) => {
		let value = rootFolderInput.value;

		if (!isValidRelativePath(value)) {
			new Notice(
				"The folder name is invalid. Reverting to the previous value."
			);
			rootFolderInput.value = this.plugin.settings.rootFolder;
			rootFolderInput.focus();
			return;
		}
		value = getCompactRelativePath(value);
		rootFolderInput.value = value;

		if (!(await this.app.vault.adapter.exists(value))) {
			await this.app.vault.createFolder(value);
		}

		this.plugin.settings.rootFolder = value;
		await this.plugin.saveSettings();
		new Notice("Successfully saved");
	};
}

export type { BMSettings };
export { DEFAULT_BM_SETTINGS, BMSettingsTab };
