import { Entity } from "dexie";
import { BibliographyDatabase } from "./bibliographyDatabase";

export class Entry extends Entity<BibliographyDatabase> {
	id!: number;
}

// Any update to the schema should be reflected in a new entry in the 
// entrySchemaHistory object to allow Dexie to handle database migrations
export const entrySchemaHistory: { [key: string]: string } = {
	1: "++id",
};
