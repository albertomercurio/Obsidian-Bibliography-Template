import BibliographyManager from "../main";
import { App, Notice, PluginSettingTab, Setting } from "obsidian";

export class BibliographyManagerSettingTab extends PluginSettingTab {
	plugin: BibliographyManager;

	constructor(app: App, plugin: BibliographyManager) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		let { containerEl } = this;

		containerEl.empty();

		let inputEl: HTMLInputElement;

		new Setting(containerEl)
			.setName("Root folder")
			.setDesc(
				"The folder where the bibliography will reside in (relative to the vault root). If the folder does not exist, it will be created."
			)
			.addText((text) => {
				inputEl = text
					.setPlaceholder("Bibliography root folder")
					.setValue(this.plugin.settings.rootFolder).inputEl;
			})
			.addButton((button) =>
        // Check if the folder name is valid and save the settings
        // If the folder name is invalid, show a notice, reset the input value, and focus on the input
				button.setButtonText("Save").onClick(async () => {
					let value = inputEl.value;

					if (!isValidRelativeDir(value)) {
						new Notice("Invalid folder name");
						inputEl.value = this.plugin.settings.rootFolder;
						inputEl.focus();
						return;
					}

					value = compactPath(value);
          
          if (!doesFolderExist(value, true)) {
            new Notice("Failed to create folder, please check the path");
            inputEl.value = this.plugin.settings.rootFolder;
						inputEl.focus();
            return;
          }

					inputEl.value = value;
					this.plugin.settings.rootFolder = value;
					await this.plugin.saveSettings();
          new Notice("Successfully saved");
				})
			);
	}
}


/**
 * Check if a path is a valid relative directory path.
 * @param path - The path to check.
 * @returns Whether the path is a valid relative directory path.
 * 
 * This function checks for the following:
 * - The path doesn't look like an absolute path
 * - No invalid characters are present
 * - The path doesn't contain file extensions
 * - The path doesn't contain `//` sequences
 * - The path doesn't contain `..` segments that would point to parents of the root directory
 * - The path doesn't contain `.` segments except for the current directory at the beginning
 */
function isValidRelativeDir(path: string): boolean {
	const relativePathRegex = /^(?!\/|~).+$/;
	const invalidCharsRegex = /[ <>:"|?*\x00-\x1F]/;

  if (path === "") {
    return true;
  }

	if (!relativePathRegex.test(path) || invalidCharsRegex.test(path)) {
		return false;
	}

	if (path.startsWith("./")) {
		path = path.slice(2);
	}

	// Split the path by `/` for Linux-specific path structure
	const pathSegments = path.split("/");

	// Check if it appears to be a file by looking for file extensions in the last segment
	const lastSegment = pathSegments[pathSegments.length - 1];
	if (lastSegment.slice(1).includes(".") && lastSegment !== "..") {
		return false;
	}

	if (path.includes("//")) {
		return false;
	}

	// Count occurrences of ".." and ensure it doesn't exceed rootDepth.
	// At the same time check that each segment is properly formatted
	let upLevelCount = 0;

	for (const segment of pathSegments) {
		if (segment === "..") {
			upLevelCount++;
			if (upLevelCount > 0) {
				return false;
			}
		} else if (segment.slice(1).includes(".")) {
			return false;
		} else {
			upLevelCount--;
		}
	}

	return true;
}


/**
 * Compact a path by removing the `./` prefix and trailing `/` characters, and resolving `..` segments.
 * @param path - The path to compact.
 * @returns The compacted path.
 */
function compactPath(path: string): string {
	if (path.startsWith("./")) {
		path = path.slice(2);
	}

	if (path.endsWith("/")) {
		path = path.slice(0, -1);
	}

	const pathSegments = path.split("/");
	const compactSegments = [];

	for (const segment of pathSegments) {
		if (segment === "..") {
			compactSegments.pop();
		} else {
			compactSegments.push(segment);
		}
	}

	return compactSegments.join("/");
}


/**
 * Check if a folder exists and optionally create it.
 * If the folder doesn't exist and create is true, it will return
 * true except if an error occurs during the creation.
 * If the folder doesn't exist and create is false, it will return false.
 * @param path - The path to the folder.
 * @param create - Whether to create the folder if it doesn't exist.
 * @returns Whether the folder exists.
 */
async function doesFolderExist(path: string, create: boolean = false): Promise<boolean> {
  try {
    const folderExists = await this.app.vault.adapter.exists(path);

    if (!folderExists && create) {
      await this.app.vault.createFolder(path);
      return true;
    } 

    return folderExists;

  } catch (e) {
    return false;
  }
}