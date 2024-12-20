import { Entity } from "dexie";
import { BibliographyDatabase } from "./bibliographyDatabase";

export type PersonRole =
  | "author"
  | "book_author"
  | "contributor"
  | "editor"
  | "series_editor"
  | "translator"
  | "reviewed_author"
  | "inventor"
  | "attorney_agent"
  | "programmer";

export type Person = {
  first_name: string;
  last_name: string;
  role: PersonRole;
};

export type AuthorPerson = Person & { role: "author" };
export type ContributorPerson = Person & { role: "contributor" };
export type EditorPerson = Person & { role: "editor" };
export type SeriesEditorPerson = Person & { role: "series_editor" };
export type TranslatorPerson = Person & { role: "translator" };
export type BookAuthorPerson = Person & { role: "book_author" };
export type ReviewedAuthorPerson = Person & { role: "reviewed_author" };
export type IventorPerson = Person & { role: "inventor" };
export type AttorneyAgentPerson = Person & { role: "attorney_agent" };
export type ProgrammerPerson = Person & { role: "programmer" };

export type EntryType =
  | "book"
  | "book_section"
  | "conference_paper"
  | "dataset"
  | "document"
  | "journal_article"
  | "patent"
  | "preprint"
  | "report"
  | "software"
  | "thesis"
  | "webpage";

export class Entry extends Entity<BibliographyDatabase> {
  id: number;
  entry_type: EntryType;
  title: string;
  citation_key: string;

  constructor(entry_type: EntryType, title: string, citation_key: string) {
    super();
    this.entry_type = entry_type;
    this.title = title;
    this.citation_key = citation_key;
  }
}

export class BookEntry extends Entry {
  entry_type: "book";
  people: (
    | AuthorPerson
    | EditorPerson
    | TranslatorPerson
    | SeriesEditorPerson
    | ContributorPerson
  )[];
  series: string;
  series_number: string;
  volume: string;
  number_of_volumes: string;
  edition: string;
  place: string;
  publisher: string;
  date: string;
  number_of_pages: string;
  isbn: string;
  url: string;
}

export class BookSectionEntry extends Entry {
  entry_type: "book_section";
  book_title: string;
  people: (
    | AuthorPerson
    | BookAuthorPerson
    | EditorPerson
    | TranslatorPerson
    | SeriesEditorPerson
    | ContributorPerson
  )[];
  series: string;
  series_number: string;
  volume: string;
  number_of_volumes: string;
  edition: string;
  place: string;
  publisher: string;
  date: string;
  pages: string;
  isbn: string;
  url: string;
}

export class ConferencePaperEntry extends Entry {
  entry_type: "conference_paper";
  people: (
    | AuthorPerson
    | EditorPerson
    | TranslatorPerson
    | SeriesEditorPerson
    | ContributorPerson
  )[];
  date: string;
  proceedings_title: string;
  conference_name: string;
  place: string;
  publisher: string;
  volume: string;
  pages: string;
  series: string;
  doi: string;
  isbn: string;
  url: string;
}

export class DatasetEntry extends Entry {
  entry_type: "dataset";
  people: (AuthorPerson | ContributorPerson)[];
  identifier: string;
  type: string;
  version: string;
  date: string;
  repository: string;
  repository_location: string;
  format: string;
  doi: string;
  url: string;
}

export class DocumentEntry extends Entry {
  entry_type: "document";
  people: (
    | AuthorPerson
    | EditorPerson
    | ReviewedAuthorPerson
    | SeriesEditorPerson
    | ContributorPerson
  )[];
  publisher: string;
  date: string;
  url: string;
}

export class JournalArticleEntry extends Entry {
  entry_type: "journal_article";
  people: (
    | AuthorPerson
    | EditorPerson
    | TranslatorPerson
    | ReviewedAuthorPerson
    | ContributorPerson
  )[];
  publication: string;
  volume: string;
  issue: string;
  pages: string;
  date: string;
  series: string;
  series_title: string;
  series_text: string;
  doi: string;
  issn: string;
  url: string;
}

export class PatentEntry extends Entry {
  entry_type: "patent";
  people: (IventorPerson | AttorneyAgentPerson | ContributorPerson)[];
  place: string;
  country: string;
  assignee: string;
  issuing_authority: string;
  patent_number: string;
  filing_date: string;
  pages: string;
  application_number: string;
  priority_numbers: string;
  issuing_date: string;
  references: string;
  legal_status: string;
  url: string;
}

export class PreprintEntry extends Entry {
  entry_type: "preprint";
  people: (
    | AuthorPerson
    | EditorPerson
    | TranslatorPerson
    | ReviewedAuthorPerson
    | ContributorPerson
  )[];
  genre: string;
  repository: string;
  archive_id: string;
  place: string;
  date: string;
  series: string;
  series_number: string;
  doi: string;
  url: string;
}

export class ReportEntry extends Entry {
  entry_type: "report";
  people: (
    | AuthorPerson
    | TranslatorPerson
    | SeriesEditorPerson
    | ContributorPerson
  )[];
  report_number: string;
  report_type: string;
  series_title: string;
  place: string;
  institution: string;
  date: string;
  pages: string;
  url: string;
}

export class SoftwareEntry extends Entry {
  entry_type: "software";
  people: (ProgrammerPerson | ContributorPerson)[];
  series_title: string;
  version: string;
  date: string;
  system: string;
  place: string;
  company: string;
  programming_language: string;
  isbn: string;
  url: string;
}

export class ThesisEntry extends Entry {
  entry_type: "thesis";
  people: (AuthorPerson | ContributorPerson)[];
  type: string;
  university: string;
  place: string;
  date: string;
  number_of_pages: string;
  url: string;
}

export class WebpageEntry extends Entry {
  entry_type: "webpage";
  people: (AuthorPerson | TranslatorPerson | ContributorPerson)[];
  website_title: string;
  website_type: string;
  date: string;
  url: string;
}

export const entrySchema = "++id, entry_type, title, citation_key";
