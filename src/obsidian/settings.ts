import { App, PluginSettingTab, Setting } from "obsidian";
import type ResearchImporterPlugin from "../../main";
import { DEFAULT_SETTINGS, type PluginSettings } from "../types";

export { DEFAULT_SETTINGS };
export type { PluginSettings };

export class ResearchImporterSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ResearchImporterPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const folder = (name: string, desc: string, key: "articlesFolder" | "booksFolder" | "peopleFolder" | "journalsFolder" | "publishersFolder" | "templatesFolder") =>
      new Setting(containerEl).setName(name).setDesc(desc).addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS[key])
          .setValue(this.plugin.settings[key])
          .onChange(async (value) => {
            this.plugin.settings[key] = value.trim();
            await this.plugin.saveSettings();
          })
      );

    folder("Articles folder", "Where article notes are created.", "articlesFolder");
    folder("Books folder", "Where book notes are created.", "booksFolder");
    folder("People folder", "Where person notes are created.", "peopleFolder");
    folder("Journals folder", "Where journal notes are created.", "journalsFolder");
    folder("Publishers folder", "Optional. Where publisher notes are created: books and new journals then link their publisher. Empty: the publisher of a book stays text.", "publishersFolder");
    folder(
      "Templates folder",
      "Optional. Article.md, Book.md, Person.md, Journal.md and Publisher.md in this folder set the properties, their order and the body of new notes.",
      "templatesFolder"
    );

    new Setting(containerEl)
      .setName("Log note")
      .setDesc("Optional, e.g. log.md. Commands run from Obsidian's command line with apply add what they wrote to the end of this note.")
      .addText((text) =>
        text.setValue(this.plugin.settings.logFile).onChange(async (value) => {
          this.plugin.settings.logFile = value.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Skip ORCID name search")
      .setDesc("Do not query ORCID by name for authors without an ORCID (faster imports, fewer questions).")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.skipOrcidSearch).onChange(async (value) => {
          this.plugin.settings.skipOrcidSearch = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Maximum supported authors")
      .setDesc("With more authors, the import asks for confirmation and links only the first one, keeping the full list in BibTeX. 0 means unlimited.")
      .addText((text) => {
        text
          .setPlaceholder("25")
          .setValue(String(this.plugin.settings.maxAuthors))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value.trim() || "0", 10);
            this.plugin.settings.maxAuthors = Number.isFinite(parsed) && parsed >= 0 ? parsed : 25;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "number";
        text.inputEl.min = "0";
        text.inputEl.step = "1";
      });
  }
}
