import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = join(root, "apps/web");
const requireFromWeb = createRequire(join(webRoot, "package.json"));
const { chromium } = requireFromWeb("playwright");
const { createServer } = requireFromWeb("vite");

const PAGE_MODULE =
  "/src/app/(app)/projects/components/social-posts/social-post-row-display-name-page.tsx";

const docsDir = join(webRoot, "docs/images/social-post-row-display-name");
const artifactsDir = "/opt/cursor/artifacts/social-post-row-display-name";
mkdirSync(docsDir, { recursive: true });
mkdirSync(artifactsDir, { recursive: true });

const phase = process.argv[2];
if (phase !== "before" && phase !== "after") {
  throw new Error(
    "usage: node scripts/capture-social-post-row-display-name.mjs before|after",
  );
}

const html = `<!doctype html><html lang="en"><head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head><body>
  <div id="fixture"></div>
  <script>
    window.addEventListener("error", (event) => {
      document.body.dataset.moduleError = String(event.error || event.message);
    });
  </script>
  <script type="module">
    import "/src/app/globals.css";
    import ${JSON.stringify(PAGE_MODULE)};
  </script>
  </body></html>`;

const server = await createServer({
  configFile: join(webRoot, "vitest.config.ts"),
  root: webRoot,
  cacheDir: join(webRoot, "node_modules/.vite-social-row-display-name"),
  logLevel: "error",
  define: { "process.env": JSON.stringify({ NODE_ENV: "development" }) },
  plugins: [
    {
      name: "social-post-row-display-name-page",
      configureServer(devServer) {
        devServer.middlewares.use((request, response, next) => {
          if (request.url?.split("?")[0] !== "/") return next();
          devServer
            .transformIndexHtml("/", html)
            .then((transformed) => {
              response.setHeader("content-type", "text/html");
              response.end(transformed);
            })
            .catch(next);
        });
      },
    },
  ],
  optimizeDeps: { entries: [PAGE_MODULE.slice(1)] },
  server: { host: "127.0.0.1", port: 0, hmr: false },
});

await server.listen();
await server.environments.client.warmupRequest(PAGE_MODULE);
await server.environments.client.waitForRequestsIdle();

const address = server.httpServer?.address();
if (!address || typeof address === "string") {
  throw new Error("Missing fixture port");
}

const browser = await chromium.launch({ chromiumSandbox: true });
const shots = [
  ["light-desktop", { width: 1280, height: 800 }, false],
  ["dark-desktop", { width: 1280, height: 800 }, true],
  ["light-mobile", { width: 390, height: 844 }, false],
];

try {
  for (const [name, viewport, dark] of shots) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.route("**/*", (route) => {
      if (new URL(route.request().url()).hostname === "127.0.0.1") {
        return route.continue();
      }
      return route.abort();
    });
    await page.goto(`http://127.0.0.1:${address.port}/`);
    try {
      await page.waitForSelector(
        "body[data-hydrated],body[data-module-error]",
        {
          state: "attached",
          timeout: 30_000,
        },
      );
    } catch (error) {
      throw new Error(
        `Mount wait failed: ${errors.join(" | ") || error.message}`,
      );
    }
    const moduleError = await page.getAttribute("body", "data-module-error");
    if (moduleError) {
      throw new Error(`Mount failed: ${moduleError}; ${errors.join("; ")}`);
    }
    if (errors.length > 0) {
      throw new Error(`Page errors: ${errors.join("; ")}`);
    }
    if (dark) {
      await page.evaluate(() => document.documentElement.classList.add("dark"));
    }
    await page.waitForSelector('[data-testid="social-post-post-draft"]');
    const file = `${phase}-${name}.png`;
    await page
      .locator('[data-testid="social-post-post-draft"]')
      .screenshot({ path: join(docsDir, file) });
    await page.screenshot({ path: join(artifactsDir, file), fullPage: true });
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

console.log(`wrote ${phase} shots to ${docsDir}`);
