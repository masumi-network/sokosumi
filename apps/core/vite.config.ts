import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  build: {
    ssr: "src/index.ts",
    outDir: "dist",
    sourcemap: true,
    target: "node24",
    minify: "esbuild",
    rollupOptions: {
      output: {
        format: "esm",
        entryFileNames: "index.js",
        inlineDynamicImports: true,
      },
    },
  },
});
