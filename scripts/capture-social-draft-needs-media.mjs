import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(join(root, "apps/web/package.json"))(
  "playwright",
);
const outDir = join(root, "apps/web/docs/images/social-draft-needs-media");
const artifactsDir = "/opt/cursor/artifacts/social-draft-needs-media";
mkdirSync(outDir, { recursive: true });
mkdirSync(artifactsDir, { recursive: true });
mkdirSync("/tmp/social-draft-needs-media", { recursive: true });

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
     writeFileSync("/tmp/social-draft-needs-media/preview.css", result.css);`,
  ],
  { cwd: join(root, "apps/web") },
);

const previewCss = readFileSync(
  "/tmp/social-draft-needs-media/preview.css",
  "utf8",
);
const browser = await chromium.launch({ channel: "chrome" });
for (const variant of ["before", "after"]) {
  const markup = execFileSync(
    "pnpm",
    ["exec", "tsx", "scripts/render-social-draft-needs-media.tsx", variant],
    { cwd: join(root, "apps/web"), encoding: "utf8" },
  );
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({
      viewport: { width: 560, height: 280 },
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
  <style>${previewCss}
    html, body { margin: 0; }
    body {
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
    const pngName = `${variant}-${theme}.png`;
    const buffer = await page.locator("body > div").screenshot({ type: "png" });
    writeFileSync(join(outDir, pngName), buffer);
    writeFileSync(join(artifactsDir, pngName), buffer);
    await page.close();
    console.log(join(outDir, pngName));
  }
}
await browser.close();
