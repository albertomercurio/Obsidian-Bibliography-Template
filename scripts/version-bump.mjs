// Used by `npm version patch --no-git-tag-version`.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const { version } = read("package.json");
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Use an x.y.z release version");
const manifest = { ...read("manifest.json"), version };
const versions = existsSync("versions.json") ? read("versions.json") : {};
versions[version] = manifest.minAppVersion;
for (const [path, data] of [["manifest.json", manifest], ["versions.json", versions]]) writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
