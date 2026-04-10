import { defineConfig } from "tsup";

export default defineConfig([
  // Client entry — React components and hooks
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ["react", "react-dom", "@waffo/pancake-ts"],
    banner: {
      js: '"use client";',
    },
  },
  // Server entry — server actions (no "use client" banner)
  {
    entry: { server: "src/server.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    external: ["@waffo/pancake-ts"],
  },
]);
