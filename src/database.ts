import { normalizePath } from "obsidian";
import ObsidianBibliographyManagerPlugin from "./main";

interface ReferenceEntry {
    citekey: string;
    metadata: any;
    bibtex: string;
}

const DATABASE_FILENAME = "bibliography_database.json";

export class BibliographyDatabase {
    private plugin: ObsidianBibliographyManagerPlugin;

    constructor(plugin: ObsidianBibliographyManagerPlugin) {
        this.plugin = plugin;
    }

    // Create or ensure the database file exists
    async ensureDatabaseFileExists() {
        const file = normalizePath(this.plugin.manifest.dir + "/" + DATABASE_FILENAME);

        if (!(await this.plugin.app.vault.adapter.exists(file))) {
            await this.plugin.app.vault.adapter.write(file, JSON.stringify([], null, 2));
        }

        return file;
    }

    // Load the database content
    async loadDatabase(): Promise<ReferenceEntry[]> {
        const file = await this.ensureDatabaseFileExists();
        const content = await this.plugin.app.vault.adapter.read(file);
        return JSON.parse(content);
    }

    // Save the database content
    async saveDatabase(data: ReferenceEntry[]): Promise<void> {
        const file = await this.ensureDatabaseFileExists();
        await this.plugin.app.vault.adapter.write(file, JSON.stringify(data, null, 2));
    }

    // Check if a reference exists by DOI
    async referenceExists(doi: string): Promise<boolean> {
        const data = await this.loadDatabase();
        return data.some(entry => entry.metadata.DOI === doi.toLowerCase());
    }

    // Add a new reference
    async addReference(newEntry: ReferenceEntry): Promise<void> {
        const data = await this.loadDatabase();
        const exists = await this.referenceExists(newEntry.metadata.DOI);

        if (!exists) {
            // Normalize the DOI to lowercase
            newEntry.metadata.DOI = newEntry.metadata.DOI.toLowerCase();
            data.push(newEntry);
            await this.saveDatabase(data);
        } else {
            throw new Error(`Reference with DOI ${newEntry.metadata.DOI} already exists.`);
        }
    }

    // Find a reference by DOI
    async getReferenceByDOI(doi: string): Promise<ReferenceEntry | undefined> {
        const data = await this.loadDatabase();
        return data.find(entry => entry.metadata.DOI === doi.toLowerCase());
    }

    // Remove a reference by DOI
    async removeReferenceByDOI(doi: string): Promise<void> {
        let data = await this.loadDatabase();
        const initialLength = data.length;
        data = data.filter(entry => entry.metadata.DOI !== doi.toLowerCase());

        if (data.length !== initialLength) {
            await this.saveDatabase(data);
            console.log(`Reference with DOI ${doi} removed.`);
        } else {
            console.warn(`Reference with DOI ${doi} not found.`);
        }
    }
}
