// Local release gate; the same check runs before GitHub publishes a tag.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const manifest = readJson("manifest.json");
const pkg = readJson("package.json");
const versions = readJson("versions.json");
const semver = /^\d+\.\d+\.\d+$/;
assert(semver.test(manifest.version), "version must be x.y.z, without a v prefix");
assert(semver.test(manifest.minAppVersion), "minAppVersion must be x.y.z");
assert.equal(pkg.version, manifest.version, "package.json and manifest.json versions differ");
assert.equal(versions[manifest.version], manifest.minAppVersion, "versions.json is missing the current minimum app version");
if (process.argv[2] !== undefined) assert.equal(process.argv[2], manifest.version, "tag must match manifest.json version exactly");
assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id) && !manifest.id.includes("obsidian"), "invalid plugin ID");
assert(manifest.name && manifest.author && typeof manifest.isDesktopOnly === "boolean", "required manifest fields are missing");
assert(manifest.description.length > 0 && manifest.description.length <= 250 && manifest.description.endsWith("."), "description must end in a period and fit in 250 characters");
for (const file of ["README.md", "LICENSE"]) assert(readFileSync(file, "utf8").trim(), `${file} is missing or empty`);
for (const file of ["manifest.json", "LICENSE", "styles.css"]) {
  if (existsSync(file)) assert(readFileSync(file).equals(readFileSync(`dist/${file}`)), `dist/${file} differs from its source; rebuild first`);
}
const notices = readFileSync("dist/THIRD_PARTY_NOTICES.txt", "utf8");
const code = readFileSync("dist/main.js", "utf8");
assert(code.includes(readFileSync("LICENSE", "utf8").replaceAll("*/", "* /")), "the installed bundle must include the plugin licence");
assert(code.includes(notices.replaceAll("*/", "* /")), "the installed bundle must include third-party notices");
// Loading the actual distributable without Node/Electron or a DOM catches
// accidental top-level desktop imports. This is a load check, not a UI test.
const exports = {};
const Stub = class {};
const obsidian = new Proxy({}, { get: (_target, key) => key === "Platform" ? { isDesktopApp: false, isMobileApp: true, isMacOS: false } : Stub });
const sandbox = { module: { exports }, exports, console, require: (id) => {
  assert.equal(id, "obsidian", `bundle loads ${id} at startup; it will fail on mobile`);
  return obsidian;
} };
runInNewContext(code, sandbox, { filename: "dist/main.js", timeout: 10000 });
assert.equal(typeof sandbox.module.exports.default, "function", "bundle does not export a plugin class");
console.log(`Release ready: ${manifest.id} ${manifest.version}; assets, licences and mobile bundle loading checked.`);
