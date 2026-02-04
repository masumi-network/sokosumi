import build from "@hono/vite-build/node";
import devServer from "@hono/vite-dev-server";
import nodeAdapter from "@hono/vite-dev-server/node";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    devServer({
      entry: "src/index.ts",
      adapter: nodeAdapter,
    }),
    build({
      entry: "src/index.ts",
    }),
  ],
});
