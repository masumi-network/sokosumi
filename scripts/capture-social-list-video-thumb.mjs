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
  : join(root, "apps/web/docs/images/social-list-video-thumb");
const prefix = process.argv[3] ?? "before";

mkdirSync(outDir, { recursive: true });
mkdirSync("/tmp/social-list-video-thumb", { recursive: true });

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
     writeFileSync("/tmp/social-list-video-thumb/preview.css", result.css);`,
  ],
  { cwd: join(root, "apps/web") },
);

const markup = execFileSync(
  "pnpm",
  ["exec", "tsx", "scripts/render-social-list-video-thumb.tsx"],
  { cwd: join(root, "apps/web"), encoding: "utf8" },
);

const widths = [
  { name: "375", width: 375, height: 320 },
  { name: "768", width: 768, height: 320 },
];

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome-stable",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
for (const theme of ["light", "dark"]) {
  const htmlPath = `/tmp/social-list-video-thumb/${prefix}-${theme}.html`;
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
  for (const viewport of widths) {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 2,
    });
    await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.locator("video").evaluate((node) => {
      const video = node;
      if (video.readyState >= 2) return;
      return new Promise((resolve) => {
        video.addEventListener("loadeddata", () => resolve(), { once: true });
        setTimeout(resolve, 2000);
      });
    });
    const file = `${prefix}-${viewport.name}-${theme}.png`;
    const buffer = await page.locator("article").screenshot({ type: "png" });
    writeFileSync(join(outDir, file), buffer);
    console.log(join(outDir, file));
    await page.close();
  }
}
await browser.close();
