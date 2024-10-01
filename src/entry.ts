import { isDoi } from "./utils";
import { CrossrefResponse } from "./interfaces/crossref";

class NameField {
	constructor(
		public family: string,
		public given: string,
		public prefix?: string,
		public suffix?: string
	) {}
}

class BibliographyEntry {
	type: "article";
	citeKey?: string;

    markdownMetadata(): string {
        throw new Error("the 'markdownMetadata' method must be overridden.");
    }

    toMarkdown(): string {
        let md = this.markdownMetadata();
        return md;
    }
}

class ArticleBE extends BibliographyEntry {
	type: "article";
	author: NameField[];
	title: string;
	journaltitle: string;
	year: number;
	date?: Date;
	doi?: string;

	constructor(
		author: NameField[],
		title: string,
		journaltitle: string,
		year?: number,
		date?: Date,
		doi?: string
	) {
		super();

		if (!year && !date) {
			throw new Error("Either year or date must be provided.");
		} else if (year && date && year !== date.getFullYear()) {
			throw new Error("The year and the date's year don't match.");
		}

		this.author = author;
		this.title = title;
		this.journaltitle = journaltitle;
		this.date = date;
		this.year = year || date!.getFullYear();
		this.doi = doi;

		this.setCitekey();
	}

	setCitekey(): void {
		let firstAuthor = this.author[0].family || "Unknown";
		let year = this.year;
		let firstWordTitle = this.title.split(" ")[0] || "Unknown";
		this.citeKey = `${firstAuthor}${year}${firstWordTitle}`;
	};

	markdownMetadata(): string {
        let authors = this.author.map((a) => {
            let s = `  - given: '${a.given}'\n`
            .concat(`    family: '${a.family}'\n`)
            .concat(a.prefix ? `    prefix: '${a.prefix}'\n` : "")
            .concat(a.suffix ? `    suffix: '${a.suffix}'\n` : "");
            return s;
        })

		let md = "---\n"
            .concat(`title: '${this.title}'\n`)
            .concat(`author: \n`)
            .concat(authors.join(""))
            .concat(`journaltitle: '${this.journaltitle}'\n`)
            .concat(this.year ? `year: ${this.year}\n` : "")
            .concat(this.date ? `date: ${this.date.toISOString()}\n` : "")
            .concat(this.doi ? `doi: '${this.doi}'\n` : "")
            .concat("---\n");
		return md;
	};

	static fromCrossrefJson(data: CrossrefResponse): ArticleBE {
		let author = data.author.map((a) => {
			return new NameField(a.family, a.given, a.prefix, a.suffix);
		});

		let dateArray = data.issued["date-parts"][0];
		let year = dateArray[0];
		let month = dateArray.length > 1 ? dateArray[1] - 1 : 0;
		let day = dateArray.length > 2 ? dateArray[2] : 1;
		let date = new Date(year, month, day);

		if (data["container-title"].length > 1) {
			throw new Error("The container title has more than one value.");
		}
		let journaltitle = data["container-title"][0];

		if (data.title.length > 1) {
			throw new Error("The title has more than one value.");
		}
		let title = data.title[0];

		let doi = data.DOI;

		return new ArticleBE(author, title, journaltitle, year, date, doi);
	};
}

const fetchEntryFromDoi = async (doi: string): Promise<any> => {
	if (!isDoi(doi)) {
		throw new Error("The input doesn't look like a valid DOI.");
	}

	let headers = new Headers({
		"User-Agent":
			"ObsidianBibliographyManager (mailto: lor.fioroni@gmail.com)",
	});
	let response = await fetch(
		`https://api.crossref.org/works/${encodeURIComponent(doi)}`,
		{ headers: headers }
	);

	if (!response.ok) {
		throw new Error("Could not fetch the DOI from Crossref.");
	}

	let data = await response.json();

	if (data.status !== "ok") {
		throw new Error("Could not fetch the DOI from Crossref.");
	}

	const entry = CrossrefJsonToEntry(data.message as CrossrefResponse);
	return entry;
};

const CrossrefJsonToEntry = (data: CrossrefResponse) => {
	switch (data.type) {
		case "journal-article":
			return ArticleBE.fromCrossrefJson(data);
		default:
			throw new Error("The entry type is not supported.");
	}
};

export { fetchEntryFromDoi };
