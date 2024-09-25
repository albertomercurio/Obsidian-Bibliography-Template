import { Plugin, Notice, Modal } from "obsidian";
import { BibliographyManagerSettingTab } from "res/settings_tab";


/**
 * List of required plugins for Bibliography Manager to work.
 */
const REQUIRED_PLUGINS = [
	"templater-obsidian", 
];

/**
 * This function checks if the required plugins are enabled.
 * It iterates over the list of required plugins and checks if they are enabled.
 * It returns an object with a status field that is true if all required plugins are enabled and false otherwise.
 * If the status is false, the object also contains a missing field with the name of the first missing plugin.
 */
function checkRequirements(plugins : Set<String>): {status: boolean, missing?: string} {
	for (let plugin of REQUIRED_PLUGINS) {
		if (!plugins.has(plugin)) {
			return {status: false, missing: plugin};
		}
	}
	return {status: true};
}

interface BibliographyManagerSettings {
	rootFolder: string;
}

const DEFAULT_SETTINGS: Partial<BibliographyManagerSettings> = {
	rootFolder: "Bibliography",
};

export default class BibliographyManager extends Plugin {
	settings: BibliographyManagerSettings;

	/**
	 * This function is called when the plugin is loaded.
	 * It loads the settings of the plugin.
	 * It checks if the required plugins are enabled and disables itself if they are not.
	 */
	async onload() {

		await this.loadSettings();
		this.addSettingTab(new BibliographyManagerSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(this.checkRequirementsAndDisable);	

	}
    
	/**
	 * This function loads the settings of the plugin with the default settings.
	 */
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	/**
	 * This function saves the settings
	 */
	async saveSettings() {
		await this.saveData(this.settings);
	}
	
	/**
	 * This function checks if the required plugins are enabled and disables the plugin if they are not.
	 */
	checkRequirementsAndDisable = () => {
		const res = checkRequirements(this.app.plugins.enabledPlugins);
		if (!res.status) {
			new Notice(`Missing required plugin '${res.missing}'. Disabling Bibliography Manager.`);
			this.app.plugins.disablePluginAndSave(this.manifest.id);
			const settingsPage = this.app.setting.activeTab;
			if (settingsPage && settingsPage.id === "community-plugins") {
				settingsPage.display();
			}
		}
	}
}
}