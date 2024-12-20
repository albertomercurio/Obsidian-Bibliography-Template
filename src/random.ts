import { faker } from "@faker-js/faker";
import { JournalArticleEntry, Person, PersonRole } from "./database/entry";

function randomPerson<T extends PersonRole>(roles: T[]): Person {
  const role = faker.helpers.arrayElement(roles);
  const author = {
    first_name: faker.person.firstName(),
    last_name: faker.person.lastName(),
    role: role,
  };
  return author;
}

function randomPublication(): string {
  return faker.helpers.arrayElement([
    "Physical Review A",
    "Physical Review Letters",
    "Journal of Quantum Information",
    "Quantum",
    "Nature Physics",
    "Nature Communications",
    "Science Advances",
    "New Journal of Physics",
    "Quantum Science and Technology",
    "Reviews of Modern Physics",
    "Journal of Mathematical Physics",
    "Annals of Physics",
    "International Journal of Quantum Chemistry",
    "Journal of Physics A: Mathematical and Theoretical",
    "Journal of Applied Physics",
    "Advances in Quantum Chemistry",
    "Entropy",
    "Europhysics Letters (EPL)",
    "Progress in Quantum Electronics",
    "Foundations of Physics",
    "International Journal of Theoretical Physics",
    "Quantum Reports",
    "Applied Physics B: Lasers and Optics",
    "Communications in Mathematical Physics",
    "Journal of the Optical Society of America B",
    "Optics Express",
    "Physica Scripta",
    "Journal of Modern Optics",
    "Acta Physica Polonica A",
    "Physics Letters A",
    "Quantum Information Processing",
    "Quantum Information and Computation",
    "Open Systems & Information Dynamics",
    "Journal of Computational and Theoretical Nanoscience",
    "Chinese Physics Letters",
    "European Physical Journal D",
    "Physics Reports",
    "Advances in Physics: X",
    "Laser Physics",
    "Reports on Progress in Physics",
    "Journal of Physics: Condensed Matter",
    "International Journal of Quantum Information",
    "Physica E: Low-dimensional Systems and Nanostructures",
    "Modern Physics Letters A",
    "Superconductor Science and Technology",
    "Quantum Measurements and Quantum Metrology",
    "Optica",
    "Acta Physica Hungarica B",
    "Physics Today",
    "Applied Physics Letters",
    "Semiconductor Science and Technology",
  ]);
}

function randomDOI(): string {
  return faker.helpers.fromRegExp(/10\.\d{4,9}\/[a-zA-Z0-9\-._]+/);
}

export function randomJournalArticleEntry(): JournalArticleEntry {
  const authorNumber = faker.number.int({ min: 1, max: 5 });
  const authors: Person[] = [];

  for (let i = 0; i < authorNumber; i++) {
    authors.push(randomPerson(["author"]));
  }

  const entry = <JournalArticleEntry>{
    entry_type: "journal_article",
    title: faker.book.title(),
    citation_key: faker.string.alphanumeric(10),
    people: authors,
    publication: randomPublication(),
    volume: faker.number.int({ min: 1, max: 100 }).toString(),
    issue: faker.number.int({ min: 1, max: 100 }).toString(),
    pages: `${faker.number.int({ min: 1, max: 100 })}-${faker.number.int({
      min: 1,
      max: 100,
    })}`,
    date: faker.date.recent().toISOString(),
    series: faker.string.alphanumeric(30),
    series_title: faker.string.alphanumeric(30),
    series_text: faker.string.alphanumeric(30),
    doi: randomDOI(),
    issn: faker.helpers.fromRegExp(/\d{4}-\d{4}/),
    url: faker.internet.url(),
  };
  return entry;
}
