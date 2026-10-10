import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB_ROOT = join(REPO_ROOT, "apps/web");
const PAGE_MODULE =
  "/src/app/(app)/projects/components/social-posts/__tests__/performance-auto-sync-page.tsx";
const artifactsDir = "/opt/cursor/artifacts/performance-screenshots";
const repoDir = join(REPO_ROOT, "docs/images/performance-screenshots");

mkdirSync(artifactsDir, { recursive: true });
mkdirSync(repoDir, { recursive: true });

const requireFromWeb = createRequire(join(WEB_ROOT, "package.json"));

async function importFromWeb(specifier) {
  return import(pathToFileURL(requireFromWeb.resolve(specifier)).href);
}

function pageHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script type="module">
      import "/src/app/globals.css";
      import ${JSON.stringify(PAGE_MODULE)};
    </script>
  </body>
</html>`;
}

const FIXTURE_MOCKS = {
  "next/navigation": `\
export const useRouter = () => ({ push() {}, replace() {}, refresh() {} });
export const usePathname = () => "/projects/project-1";
export const useSearchParams = () => new URLSearchParams();
`,
  "next/link": `\
import { createElement } from "react";
export default function Link({ href, children, ...props }) {
  return createElement("a", { href, ...props }, children);
}
`,
  "@/lib/auth/auth.client": `\
export const useSession = () => ({
  data: {
    user: { id: "user-1" },
    session: { activeOrganizationId: "org-1" },
  },
  isPending: false,
});
`,
  "@/lib/actions/project/social-performance-refresh.action": `\
export async function refreshSocialAccountPerformance() {
  return { success: true };
}
`,
  "@/lib/actions/project/action": `\
export async function disconnectProjectSocialConnection() {
  return { ok: true, value: { providerRevocation: "succeeded" } };
}
export async function finalizeProjectSocialConnection() {
  return { ok: true, value: {} };
}
export async function initiateProjectSocialConnection() {
  return { ok: true, value: { redirectUrl: "https://example.test" } };
}
`,
  "@/lib/actions/composio/action": `\
export async function completeComposioAuthCallbackAction() {
  return { ok: true, value: {} };
}
`,
  "@/lib/composio/use-composio-oauth-popup": `\
export function useComposioOAuthPopup() {
  return { runPopupOAuth: async () => ({ kind: "in_flight" }) };
}
`,
};

async function shot(page, name, locator) {
  const repoPath = join(repoDir, name);
  const artifactPath = join(artifactsDir, name);
  if (locator) {
    await locator.screenshot({ path: repoPath });
    await locator.screenshot({ path: artifactPath });
  } else {
    await page.screenshot({ path: repoPath, fullPage: true });
    await page.screenshot({ path: artifactPath, fullPage: true });
  }
  console.log(`✓ ${name}`);
}

async function shotUnion(page, locators, name) {
  const boxes = [];
  for (const locator of locators) {
    const box = await locator.boundingBox();
    if (box) boxes.push(box);
  }
  if (boxes.length === 0) throw new Error(`no boxes for ${name}`);
  const pad = 16;
  const x = Math.max(0, Math.min(...boxes.map((box) => box.x)) - pad);
  const y = Math.max(0, Math.min(...boxes.map((box) => box.y)) - pad);
  const right = Math.max(...boxes.map((box) => box.x + box.width)) + pad;
  const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + pad;
  const clip = { x, y, width: right - x, height: bottom - y };
  await page.screenshot({ path: join(repoDir, name), clip });
  await page.screenshot({ path: join(artifactsDir, name), clip });
  console.log(`✓ ${name}`);
}

async function openShot(page, port, theme, shotName, viewport) {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme });
  await page.goto(`http://127.0.0.1:${port}/?shot=${shotName}&theme=${theme}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => {
    const root = document.documentElement;
    return (
      getComputedStyle(document.body).backgroundColor !== "rgba(0, 0, 0, 0)" ||
      root.classList.contains("dark") ||
      root.classList.contains("light")
    );
  });
}

async function main() {
  const [{ createServer }, { default: react }] = await Promise.all([
    importFromWeb("vite"),
    importFromWeb("@vitejs/plugin-react"),
  ]);

  const server = await createServer({
    configFile: join(WEB_ROOT, "vitest.config.ts"),
    root: WEB_ROOT,
    cacheDir: join(WEB_ROOT, "node_modules/.vite-performance-screenshots"),
    logLevel: "error",
    define: { "process.env": JSON.stringify({ NODE_ENV: "development" }) },
    plugins: [
      react(),
      {
        name: "performance-auto-sync-page",
        enforce: "pre",
        resolveId(id) {
          if (id === "server-only") return "\0fixture-server-only";
          if (FIXTURE_MOCKS[id]) return `\0fixture:${id}`;
        },
        load(id) {
          if (id === "\0fixture-server-only") return "export {}";
          if (id.startsWith("\0fixture:")) {
            return FIXTURE_MOCKS[id.slice("\0fixture:".length)];
          }
        },
        configureServer(devServer) {
          devServer.middlewares.use((request, response, next) => {
            const path = request.url?.split("?")[0];
            if (path !== "/") {
              next();
              return;
            }
            devServer
              .transformIndexHtml("/", pageHtml())
              .then((html) => {
                response.setHeader("content-type", "text/html");
                response.end(html);
              })
              .catch(next);
          });
        },
      },
    ],
    optimizeDeps: {
      entries: [PAGE_MODULE.slice(1)],
      exclude: ["next/navigation", "next/link", "server-only"],
    },
    server: { host: "127.0.0.1", port: 0, hmr: false },
  });

  await server.listen();
  await server.environments.client.warmupRequest(PAGE_MODULE);
  await server.environments.client.waitForRequestsIdle();

  const address = server.httpServer?.address();
  if (!address || typeof address === "string") {
    throw new Error("the page server has no port");
  }

  const browser = await chromium.launch();
  const desktop = { width: 1280, height: 900 };
  const mobile = { width: 375, height: 812 };

  try {
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage();
      page.on("pageerror", (error) => {
        console.error(`pageerror (${theme}):`, error.message);
      });

      await openShot(page, address.port, theme, "updated", desktop);
      await page.getByTestId("performance-header").waitFor({ timeout: 30_000 });
      await page.getByText(/^Updated /).waitFor();
      await shot(page, `after-${theme}-desktop.png`);
      await shot(
        page,
        `header-updated-${theme}.png`,
        page.getByTestId("performance-header"),
      );

      await openShot(page, address.port, theme, "syncing", desktop);
      await page.getByText("Syncing…").waitFor({ timeout: 30_000 });
      await shot(
        page,
        `header-syncing-${theme}.png`,
        page.getByTestId("performance-header"),
      );

      await openShot(page, address.port, theme, "settings", {
        width: 800,
        height: 640,
      });
      await page.getByTestId("project-social-accounts").waitFor({
        timeout: 30_000,
      });
      await page.getByRole("button", { name: "Actions for @masumi" }).click();
      await page.getByRole("menuitem", { name: "Sync now" }).waitFor();
      await shotUnion(
        page,
        [page.getByTestId("project-social-accounts"), page.getByRole("menu")],
        `settings-sync-now-${theme}.png`,
      );

      await page.close();
    }

    const mobilePage = await browser.newPage();

    await openShot(mobilePage, address.port, "light", "updated", mobile);
    await mobilePage.getByText(/^Updated /).waitFor({ timeout: 30_000 });
    await shot(mobilePage, "after-light-mobile.png");

    await openShot(mobilePage, address.port, "dark", "syncing", mobile);
    await mobilePage.getByText("Syncing…").waitFor({ timeout: 30_000 });
    await shot(mobilePage, "after-dark-mobile.png");

    await openShot(mobilePage, address.port, "light", "reconnect", desktop);
    await mobilePage
      .getByText("Reconnect this account before syncing statistics.")
      .waitFor({ timeout: 30_000 });
    await shot(
      mobilePage,
      "header-reconnect-light.png",
      mobilePage.getByTestId("performance-header"),
    );

    await mobilePage.close();
  } finally {
    await browser.close();
    await server.close();
  }

  console.log(`\nSaved to ${repoDir} and ${artifactsDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
