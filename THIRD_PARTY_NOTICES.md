# Third-party attribution

The plugin is MIT-licensed. Bundled dependencies retain their own licences.
`npm run build` includes their complete licence and notice files in
`dist/THIRD_PARTY_NOTICES.txt` and in `dist/main.js`, so the notices also accompany
installations made through Obsidian. The dependency lockfile records exact versions.

- [mathml-to-latex](https://github.com/asnunes/mathml-to-latex) by Alexandre Nunes — MIT licence.
- [@xmldom/xmldom](https://github.com/xmldom/xmldom) — MIT licence; the XML parser used by mathml-to-latex.

YAML (ISC licence) is used by the standalone Node test host, not bundled in the Obsidian plugin.
