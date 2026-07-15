import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "tmp-check-db.cjs",
  ]),
  {
    rules: { "@typescript-eslint/no-explicit-any": "error" },
  },
  {
    files: ["app/layout.tsx"],
    // Material Symbols is an icon font and cannot be loaded through next/font.
    rules: {
      "@next/next/google-font-display": "off",
      "@next/next/no-page-custom-font": "off",
    },
  },
]);

export default eslintConfig;
