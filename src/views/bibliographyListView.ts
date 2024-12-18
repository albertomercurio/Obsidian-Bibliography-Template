import { ItemView, WorkspaceLeaf } from "obsidian";
import { constants } from "src/constants";
import { DatabaseManager } from "src/database/databaseManager";

import MyPlugin from "src/main";

export class BibliographyListView extends ItemView{
    plugin: MyPlugin;
    
    constructor(leaf: WorkspaceLeaf, plugin: MyPlugin){
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return constants.bibliography_list_view_type;
    }

    getDisplayText(): string {
        return constants.bibliography_list_view_text;
    }

    async onOpen(){
        const container = this.containerEl.children[1];
        const dm = DatabaseManager.getInstance(this.plugin);

        container.empty();
        container.createEl('h4', { text: 'Example view' });

        (await dm.getAllEntries()).each((entry) => {
            container.createEl('div', { text: entry.id.toString() });
        })
    }   

    async onClose(){
        // do nothing
    }

}