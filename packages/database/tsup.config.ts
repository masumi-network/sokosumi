import { defineConfig } from "tsup";
import { resolve } from "path";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/client.ts",
    "src/transaction.ts",
    "src/repositories/index.ts",
    "src/helpers/index.ts",
    "src/types/index.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  outDir: "dist",
  external: ["dotenv"],
});
