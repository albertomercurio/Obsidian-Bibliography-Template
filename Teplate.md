<%* 
const bibtex_string = await tp.system.prompt("Please enter a the BibTeX citation:", null, false, true);

const bibtex_parser = await tp.user.get_bibtex_data(bibtex_string);

const type = bibtex_parser.parsedData.type;
const cite_key = bibtex_parser.generateCitationKey();
const title = bibtex_parser.getTitle_UTF8();
const authors = bibtex_parser.getAuthorsYAML();
const journal = bibtex_parser.parsedData.journal;
const year = bibtex_parser.parsedData.year;
const publisher = bibtex_parser.parsedData.publisher;
const doi = bibtex_parser.parsedData.doi;
const url = bibtex_parser.parsedData.url;
const fullBibtex = bibtex_parser.toBibTex();

if (type === 'article') {
  await tp.file.move("/Research/Bibliography/Articles/" + cite_key);
} else if (type === 'book') {
  await tp.file.move("/Research/Bibliography/Books/" + cite_key);
}

tR += "---\n"; 
if (type !== undefined) {
  tR += `type: ${type}\n`;
}
if (cite_key !== undefined) {
  tR += `cite_key: ${cite_key}\n`;
}
tR += `title: "${title}"\n`;
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
<%* tR += `- [ ] 🔽 To Comment` %>


## Comments






---


*BibTeX:*
```bibtex
<%*
tR += fullBibtex;
%>
```
