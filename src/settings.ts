import { App, PluginSettingTab, Setting } from "obsidian";
import type ResearchImporterPlugin from "../main";
import { DEFAULT_SETTINGS } from "./types";

export { DEFAULT_SETTINGS };
export type { PluginSettings } from "./types";

export class ResearchImporterSettingTab extends PluginSettingTab {
  plugin: ResearchImporterPlugin;

  constructor(app: App, plugin: ResearchImporterPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Research Literature Manager" });

    new Setting(containerEl)
      .setName("Articles folder")
      .setDesc("Vault folder where article notes are stored.")
      .addText((text) =>
        text
          .setPlaceholder("Articles")
          .setValue(this.plugin.settings.articlesFolder)
          .onChange(async (value) => {
            this.plugin.settings.articlesFolder = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Books folder")
      .setDesc("Vault folder where book notes are stored.")
      .addText((text) =>
        text
          .setPlaceholder("Books")
          .setValue(this.plugin.settings.booksFolder)
          .onChange(async (value) => {
            this.plugin.settings.booksFolder = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("People folder")
      .setDesc("Vault folder where person notes are stored.")
      .addText((text) =>
        text
          .setPlaceholder("People")
          .setValue(this.plugin.settings.peopleFolder)
          .onChange(async (value) => {
            this.plugin.settings.peopleFolder = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Journals folder")
      .setDesc("Vault folder where journal notes are stored.")
      .addText((text) =>
        text
          .setPlaceholder("Journals")
          .setValue(this.plugin.settings.journalsFolder)
          .onChange(async (value) => {
            this.plugin.settings.journalsFolder = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Skip ORCID name search")
      .setDesc(
        "When enabled, the plugin will not query the ORCID API to search for author ORCIDs by name (faster imports, less disambiguation)."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.skipOrcidSearch)
          .onChange(async (value) => {
            this.plugin.settings.skipOrcidSearch = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Maximum supported authors")
      .setDesc(
        "If an import has more authors than this limit, the plugin asks for confirmation and, if you continue, links only the first author in Obsidian while keeping the full BibTeX author list. Use 0 for unlimited."
      )
      .addText((text) => {
        text
          .setPlaceholder("25")
          .setValue(String(this.plugin.settings.maxAuthors))
          .onChange(async (value) => {
            const trimmed = value.trim();
            const parsed = Number.parseInt(trimmed || "0", 10);
            this.plugin.settings.maxAuthors =
              Number.isFinite(parsed) && parsed >= 0 ? parsed : 25;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "number";
        text.inputEl.min = "0";
        text.inputEl.step = "1";
      });
  }
}
