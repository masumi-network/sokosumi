import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
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
});
