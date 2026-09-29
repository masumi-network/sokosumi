import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    target: "node20",
    outDir: "dist",
    // Both builds share `dist`; the build script clears it once up front so
    // neither can delete the other's output.
    clean: false,
    sourcemap: true,
    dts: false,
    // `@sokosumi/database` ships TypeScript source (ADR 0035), so it must be
    // compiled into the bundle. Its Prisma drivers stay external: `pg` is
    // CommonJS and dies at import when inlined, and keeping `@prisma/client`
    // external stops the wasm query compiler being embedded as base64.
    noExternal: ["@sokosumi/database"],
    external: ["pg", "@prisma/client", "@prisma/adapter-pg"],
    esbuildOptions(options) {
      options.alias = {
        "@": "./src",
      };
    },
  },
  {
    // The Soko Bot runner is copied into each bot's sandbox and run with plain
    // `node`, so it carries every dependency in one file.
    entry: { "soko-bot-runner": "src/soko-bot-runner/index.ts" },
    format: ["esm"],
    target: "node24",
    platform: "node",
    outDir: "dist",
    outExtension: () => ({ js: ".mjs" }),
    clean: false,
    sourcemap: false,
    dts: false,
    splitting: false,
    noExternal: [/.*/],
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
  },
]);
