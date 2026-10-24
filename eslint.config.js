import js from "@eslint/js";
import svelte from "eslint-plugin-svelte";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,
  {
    files: ["**/*.svelte", "**/*.svelte.ts"],
    languageOptions: { parserOptions: { parser: tseslint.parser, extraFileExtensions: [".svelte"] } },
    // svelte-check type-checks these files, browser globals included.
    rules: { "no-undef": "off" },
  },
  {
    rules: {
      "@typescript-eslint/explicit-member-accessibility": ["error", { accessibility: "explicit" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["src/**/*.ts", "src/**/*.svelte"],
    ignores: ["src/source.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["./print", "./png", "**/print", "**/png"], message: "Only src/source.ts may import print and png." }] },
      ],
    },
  },
);
