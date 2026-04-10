import { defineConfig, globalIgnores } from "eslint/config";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  ...tseslint.configs.recommended,

  {
    plugins: {
      "react-hooks": reactHooksPlugin,
    },
    rules: {
      ...reactHooksPlugin.configs.recommended.rules,
    },
  },

  // Relax naming convention for config files
  {
    files: ["eslint.config.mjs", "vitest.config.ts", "tsup.config.ts", "commitlint.config.js"],
    rules: {
      "@typescript-eslint/naming-convention": "off",
    },
  },

  globalIgnores(["dist/**", "node_modules/**", "coverage/**"]),
]);

export default eslintConfig;
