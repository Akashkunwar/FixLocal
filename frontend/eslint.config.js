import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**", "node_modules/**", "playwright-report/**", "test-results/**", "scripts/**", "public/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/no-explicit-any": "warn",
      // Browser dialogs can't be translated or styled: use useConfirm() (components/ConfirmDialog).
      "no-restricted-globals": [
        "error",
        { name: "confirm", message: "Use useConfirm().confirm from components/ConfirmDialog." },
        { name: "prompt", message: "Use useConfirm().prompt from components/ConfirmDialog." },
        { name: "alert", message: "Use the toast (useToast) instead." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "window", property: "confirm", message: "Use useConfirm().confirm from components/ConfirmDialog." },
        { object: "window", property: "prompt", message: "Use useConfirm().prompt from components/ConfirmDialog." },
        { object: "window", property: "alert", message: "Use the toast (useToast) instead." },
      ],
    },
  },
  {
    files: ["e2e/**/*.ts", "playwright.config.ts", "vite.config.ts", "vitest.config.ts", "eslint.config.js"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["src/**/*.test.{ts,tsx}", "src/test/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  }
);
