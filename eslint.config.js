import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/explicit-member-accessibility": ["error", { accessibility: "explicit" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["src/**/*.ts"],
    ignores: ["src/source.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["./print", "./png", "**/print", "**/png"], message: "Only src/source.ts may import print and png." }] },
      ],
    },
  },
);
