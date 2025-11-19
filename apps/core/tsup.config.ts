import { readFileSync } from "fs";
import path from "path";
import { defineConfig } from "tsup";

// Read tsconfig to get path mappings
const tsconfig = JSON.parse(
  readFileSync(path.resolve(__dirname, "tsconfig.json"), "utf-8"),
);
const paths = tsconfig.compilerOptions?.paths || {};

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  sourcemap: true,
  outDir: "dist",
  tsconfig: "tsconfig.json",
  external: ["dotenv"],
  esbuildOptions(options) {
    // Build alias map from tsconfig paths
    // Convert "@/*": ["./src/*"] to "@": srcPath
    // Convert "@/config/*": ["./src/config/*"] to "@/config": srcPath/config
    const alias: Record<string, string> = {};

    for (const [aliasKey, aliasPaths] of Object.entries(paths)) {
      if (Array.isArray(aliasPaths) && aliasPaths.length > 0) {
        // Remove the /* wildcard and resolve the path
        const cleanKey = aliasKey.replace(/\/\*$/, "");
        const cleanPath = aliasPaths[0].replace(/\/\*$/, "");
        const resolvedPath = path.resolve(__dirname, cleanPath);
        alias[cleanKey] = resolvedPath;
      }
    }

    options.alias = alias;
    options.resolveExtensions = [".ts", ".tsx", ".js", ".jsx", ".json"];
  },
});
