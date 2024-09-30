<%* 
const doi_string = await tp.system.prompt("Please enter the DOI: (e.g., 10.1103/PhysRevLett.130.123601)", null, false, true);

const bibtex_parser = await tp.user.get_bibtex_data(doi_string);

const type = bibtex_parser.parsedData.type;
const cite_key = bibtex_parser.generateCitationKey();
const title = bibtex_parser.getTitle_UTF8();
const booktitle = bibtex_parser.parsedData.booktitle;
const authors = bibtex_parser.getAuthorsYAML();
const journal = bibtex_parser.parsedData.journal;
const year = bibtex_parser.parsedData.year;
const publisher = bibtex_parser.parsedData.publisher;
const doi = bibtex_parser.parsedData.doi;
const url = bibtex_parser.parsedData.url;
const fullBibtex = bibtex_parser.toBibTex();

const authors_list = bibtex_parser.parsedAuthors;

if (type === 'article') {
  await tp.file.move("/Research/Bibliography/Articles/" + bibtex_parser.removeSpecialCharacters(`${title} - (${year}) - ${authors_list[0].lastName}`));
} else if (type === 'book' || type === 'inbook') {
  await tp.file.move("/Research/Bibliography/Books/" + bibtex_parser.removeSpecialCharacters(`${title} - (${year}) - ${authors_list[0].lastName}`));
}

tR += "---\n"; 
if (type !== undefined) {
  tR += `type: ${type}\n`;
}
if (cite_key !== undefined) {
  tR += `cite_key: ${cite_key}\n`;
}
tR += `title: "${title}"\n`;
if (booktitle !== undefined) {
  tR += `booktitle: "${booktitle}"\n`;
}
tR += `authors: \n${authors}\n`;
tR += `year: ${year}\n`;
if (publisher !== undefined) {
  tR += `publisher: "${publisher}"\n`;
}
if (journal !== undefined) {
  tR += `journal: "${journal}"\n`;
}
if (doi !== undefined) {
  tR += `doi: "${doi}"\n`;
}
if (url !== undefined) {
  tR += `url: "${url}"\n`;
}
tR += `bibtex: |\n ${fullBibtex}\n`;
tR += `tags:\n - bibliography\n`;
tR += "---";
%>
---
# <%* tR += title %>
---

<%*
const abstract = bibtex_parser.parsedData.abstract;
if (abstract !== undefined){
tR += `> [!ABSTRACT] Abstract\n> ${abstract}`
}
%>

### PDF: 



### Tasks
<%* tR += `- [ ] To Comment 🔽` %>
<%* tR += `- [ ] Add PDF  🔽` %>


## Comments






---


*BibTeX:*
```bibtex
<%*
tR += fullBibtex;
%>
```
