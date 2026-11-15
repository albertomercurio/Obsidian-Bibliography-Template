// Builds the plugin (dist/main.js). With VAULT_PLUGIN_DIR set, also installs it
// in that folder of a vault.
//   npm run dev     watch the plugin while developing
//   npm run build   build it once
import esbuild from "esbuild";
import { packageRelease } from "./scripts/package-release.mjs";
import process from "process";
import { builtinModules } from "node:module";
import { copyFileSync, mkdirSync } from "fs";

const prod = process.argv[2] === "production";
const target = process.env.VAULT_PLUGIN_DIR;

const plugin = {
  entryPoints: ["main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "dist/main.js",
};

if (prod) {
  const result = await esbuild.build({ ...plugin, metafile: true });
  packageRelease(result.metafile);
  if (target) {
    mkdirSync(target, { recursive: true });
    for (const file of ["dist/main.js", "manifest.json", "styles.css"]) {
      copyFileSync(file, `${target}/${file.split("/").pop()}`);
    }
  }
} else {
  const ctx = await esbuild.context(plugin);
  await ctx.watch();
}
