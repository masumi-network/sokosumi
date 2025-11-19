import path from "path";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  sourcemap: true,
  outDir: "dist",
  external: ["dotenv"],
  esbuildOptions(options) {
    options.alias = {
      "@": path.resolve(__dirname, "./src"),
      "@/config": path.resolve(__dirname, "./src/config"),
      "@/helpers": path.resolve(__dirname, "./src/helpers"),
      "@/lib": path.resolve(__dirname, "./src/lib"),
      "@/middleware": path.resolve(__dirname, "./src/middleware"),
      "@/routes": path.resolve(__dirname, "./src/routes"),
      "@/types": path.resolve(__dirname, "./src/types"),
    };
  },
});
