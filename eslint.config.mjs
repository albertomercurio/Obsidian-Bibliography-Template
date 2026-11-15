import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  globalIgnores(["dist/**", "node_modules/**", "tests/**", "scripts/**", "esbuild.config.mjs", "eslint.config.mjs"]),
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      // These are the documented community scanner exclusions for untyped
      // external records and Obsidian frontmatter, not security-rule overrides.
      // https://github.com/obsidianmd/eslint-plugin/blob/master/docs/configuration.md
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-base-to-string": "off",
    },
  },
  {
    files: ["src/node/**"],
    rules: { "obsidianmd/no-nodejs-modules": ["warn", { isDesktopOnly: true }] },
  },
]);
