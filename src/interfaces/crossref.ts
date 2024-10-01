interface CrossrefResponse extends JSON{
    "type": string;
    "author": {family: string, given: string, prefix?: string, suffix?: string}[];
    "issued": {"date-parts": number[][]};
    "container-title": string[];
    "title": string[];
    "DOI": string;
}

export type { CrossrefResponse };