// Package exactly the files Obsidian downloads, with the licences of bundled code.
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export function packageRelease(metafile) {
  const packages = new Map();
  for (const input of Object.keys(metafile.inputs)) {
    if (!input.includes("node_modules/")) continue;
    let folder = dirname(resolve(input));
    let pkg;
    while (true) {
      const metadata = join(folder, "package.json");
      if (existsSync(metadata)) {
        pkg = JSON.parse(readFileSync(metadata, "utf8"));
        if (pkg.name && pkg.version) break;
      }
      const parent = dirname(folder);
      if (parent === folder) throw new Error(`No package metadata for ${input}`);
      folder = parent;
    }
    packages.set(`${pkg.name}@${pkg.version}`, { folder, pkg });
  }
  const notices = [];
  for (const [name, { folder, pkg }] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    const files = readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^(licen[cs]e|copying|notice|copyrightnotice)(\..*)?$/i.test(entry.name))
      .map((entry) => join(folder, entry.name));
    // Some packages keep additional attribution, e.g. ECharts' d3 notice, here.
    for (const sub of ["licenses", "LICENSES"]) {
      const dir = join(folder, sub);
      if (existsSync(dir)) {
        files.push(...readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(dir, entry.name)));
      }
    }
    if (!files.length) throw new Error(`Missing licence text for bundled dependency ${name}`);
    notices.push(`${name} (${pkg.license ?? "see licence below"})\n${files.sort().map((file) => `\n--- ${relative(folder, file)} ---\n${readFileSync(file, "utf8").replace(/\r\n?/g, "\n").trim()}`).join("\n")}`);
  }
  const text = "Third-party licences and notices for code bundled in this plugin.\n\n" + notices.join("\n\n========================================\n\n") + "\n";
  writeFileSync("dist/THIRD_PARTY_NOTICES.txt", text);
  // Obsidian installs main.js, manifest.json and styles.css only: keep the full
  // notices in the installed JavaScript too, including in minified builds.
  const code = readFileSync("dist/main.js", "utf8");
  const ownLicense = readFileSync("LICENSE", "utf8").replaceAll("*/", "* /");
  writeFileSync("dist/main.js", `/*!\n${ownLicense}\n${text.replaceAll("*/", "* /")}*/\n${code}`);
  for (const file of ["manifest.json", "LICENSE", "styles.css"]) {
    if (existsSync(file)) copyFileSync(file, `dist/${file}`);
  }
}
