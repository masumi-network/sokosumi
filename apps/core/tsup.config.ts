import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
  noExternal: [
    "@sokosumi/ai-provider",
    "@sokosumi/chat",
    "@sokosumi/database",
    "@sokosumi/email",
    "@sokosumi/masumi",
    "@sokosumi/utils",
  ],
  esbuildOptions(options) {
    options.alias = {
      "@": "./src",
    };
  },
});
