import BibliographyManager from "main";
import { DoiInputModal } from "./modals/doiInputModal";
import { fetchEntryFromDoi } from "./entry";

async function addEntryFromDoiCallback (this: BibliographyManager) {
    let entry: any;

    try {
        let doi = await (new DoiInputModal(this).asyncOpen())
        entry = await fetchEntryFromDoi(doi)
    } catch (e) {
        console.warn(e);
        return;
    }
    
    const filename = `${entry.title} - ${entry.year} - ${entry.author[0].family}`;
    this.app.vault.create(`${this.settings.rootFolder}/${filename}.md`, entry.toMarkdown())
    .then((file) => {
        this.app.workspace.getLeaf().openFile(file);
    })
}


function addPaletteCommands(this: BibliographyManager) {
    const commands = [
        {id: "add-entry-from-doi", name: "Add entry from DOI", callback: addEntryFromDoiCallback.bind(this)},
    ]
    
    for (const command of commands) {
        this.addCommand(command);
    } 
};

export { addPaletteCommands };