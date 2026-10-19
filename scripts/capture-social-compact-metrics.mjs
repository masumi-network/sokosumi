import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(join(root, "apps/web/package.json"))(
  "playwright",
);

const outDir = process.argv[2]
  ? join(root, process.argv[2])
  : join(root, "apps/web/docs/images/social-compact-metrics");
const prefix = process.argv[3] ?? "before";
const cases = (process.argv[4] ?? "empty,partial").split(",");

mkdirSync(outDir, { recursive: true });
mkdirSync("/tmp/social-compact-metrics", { recursive: true });

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
     writeFileSync("/tmp/social-compact-metrics/preview.css", result.css);`,
  ],
  { cwd: join(root, "apps/web") },
);

const widths = [
  { name: "375", width: 375, height: 640 },
  { name: "768", width: 768, height: 640 },
];

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome-stable",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
for (const caseName of cases) {
  const markup = execFileSync(
    "pnpm",
    ["exec", "tsx", "scripts/render-social-compact-metrics.tsx", caseName],
    { cwd: join(root, "apps/web"), encoding: "utf8" },
  );
  for (const theme of ["light", "dark"]) {
    for (const viewport of widths) {
      const htmlPath = `/tmp/social-compact-metrics/${prefix}-${caseName}-${theme}.html`;
      writeFileSync(
        htmlPath,
        `<!doctype html>
<html lang="en" class="${theme === "dark" ? "dark" : ""}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="preview.css" />
  <style>
    html, body { margin: 0; }
    body {
      padding: 24px;
      background: var(--background);
      color: var(--foreground);
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    }
  </style>
</head>
<body>${markup}</body>
</html>`,
      );
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 2,
      });
      await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const file = `${prefix}-${caseName}-${viewport.name}-${theme}.png`;
      const buffer = await page.locator("article").screenshot({ type: "png" });
      writeFileSync(join(outDir, file), buffer);
      console.log(join(outDir, file));
      await page.close();
    }
  }
}
await browser.close();
