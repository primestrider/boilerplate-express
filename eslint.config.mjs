// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "coverage", "drizzle"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
      // Augmenting Express types requires `declare global { namespace ... }`.
      "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
      eqeqeq: ["error", "always"],
      "no-console": "error",
    },
  },
  {
    // CLI scripts talk to the terminal.
    files: ["src/cli/**"],
    rules: { "no-console": "off" },
  },
  // Must be last: turns off rules that conflict with Prettier.
  prettier,
);
