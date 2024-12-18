import { FileSystemAdapter } from "obsidian";
import MyPlugin from "./main";

export function pluginFile(
	plugin: MyPlugin,
	filename: string,
	absolute = false,
): string {
	const path = [
		plugin.app.vault.configDir,
		"plugin_data",
		plugin.manifest.id,
		filename,
	];
	
	if (absolute) {
		const adapter = plugin.app.vault.adapter as FileSystemAdapter;
		path.unshift(adapter.getBasePath());
	}

	return path.join("/");
}

export async function createFolderTree(plugin: MyPlugin, path: string) {
	const folders = path.split("/");
	let currentPath = "";

	for (const folder of folders) {
		currentPath = currentPath + "/" + folder;
		try {
			await plugin.app.vault.createFolder(currentPath);
		} catch (error) {
			// Folder already exists
		}
	}
}
