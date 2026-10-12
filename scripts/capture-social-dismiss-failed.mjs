import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(join(root, "apps/web/package.json"))(
  "playwright",
);

const docsDir = join(root, "apps/web/docs/images/social-dismiss-failed");
const artifactsDir = "/opt/cursor/artifacts/social-dismiss-failed";
mkdirSync(docsDir, { recursive: true });
mkdirSync(artifactsDir, { recursive: true });
mkdirSync("/tmp/social-dismiss-failed", { recursive: true });

execFileSync(
  "node",
  [
    "--input-type=module",
    "-e",
    `import postcss from "postcss";
     import tailwind from "@tailwindcss/postcss";
     import { readFileSync, writeFileSync } from "fs";
     const css = readFileSync("src/app/globals.css", "utf8");
     const result = await postcss([tailwind()]).process(css, { from: "src/app/globals.css" });
     writeFileSync("/tmp/social-dismiss-failed/preview.css", result.css);`,
  ],
  { cwd: join(root, "apps/web"), stdio: "inherit" },
);

const previewCss = readFileSync(
  "/tmp/social-dismiss-failed/preview.css",
  "utf8",
);

const cases = ["before-failed", "after-failed", "after-dialog"];
const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome-stable",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

for (const caseName of cases) {
  const markup = execFileSync(
    "pnpm",
    ["exec", "tsx", "scripts/render-social-dismiss-failed.tsx", caseName],
    { cwd: join(root, "apps/web"), encoding: "utf8" },
  );

  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({
      viewport: { width: 960, height: 640 },
      deviceScaleFactor: 2,
    });
    await page.setContent(
      `<!doctype html>
<html lang="en" class="${theme === "dark" ? "dark" : ""}">
<head>
  <meta charset="utf-8" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>${previewCss}</style>
  <style>
    html, body { margin: 0; }
    body {
      min-height: 100vh;
      background: var(--muted);
      color: var(--foreground);
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    }
  </style>
</head>
<body>${markup}</body>
</html>`,
      { waitUntil: "networkidle" },
    );
    await page.evaluate(() => document.fonts.ready);
    const file = `${caseName}-${theme}-desktop.png`;
    const locator =
      caseName === "after-dialog"
        ? page.locator('[role="alertdialog"]')
        : page.locator(".shot");
    const buffer = await locator.screenshot({ type: "png" });
    writeFileSync(join(docsDir, file), buffer);
    writeFileSync(join(artifactsDir, file), buffer);
    await page.close();
    console.log(join(docsDir, file));
  }
}

await browser.close();
