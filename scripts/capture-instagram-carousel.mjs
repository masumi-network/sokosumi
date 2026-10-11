import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(join(root, "apps/web/package.json"))(
  "playwright",
);

const prefix = process.argv[2] ?? "after";
const outDir = join(root, "apps/web/docs/images/instagram-carousel");
mkdirSync(outDir, { recursive: true });
mkdirSync("/tmp/instagram-carousel", { recursive: true });

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
     writeFileSync("/tmp/instagram-carousel/preview.css", result.css);`,
  ],
  { cwd: join(root, "apps/web") },
);

const css = readFileSync("/tmp/instagram-carousel/preview.css", "utf8");
const body = execFileSync(
  "pnpm",
  [
    "exec",
    "tsx",
    "scripts/render-social-post-preview.tsx",
    "instagram-carousel",
  ],
  { cwd: join(root, "apps/web"), encoding: "utf8" },
);

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome-stable",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const frames = [
  { name: "desktop", viewport: { width: 1280, height: 900 }, card: 420 },
  { name: "phone", viewport: { width: 390, height: 844 }, card: 342 },
];

for (const theme of ["light", "dark"]) {
  for (const frame of frames) {
    const page = await browser.newPage({
      viewport: frame.viewport,
      deviceScaleFactor: 2,
    });
    await page.setContent(
      `<!doctype html>
<html lang="en" class="${theme === "dark" ? "dark" : ""}">
<head>
  <meta charset="utf-8" />
  <style>
${css}
    html, body { margin: 0; }
    body {
      min-height: 100vh;
      padding: 24px;
      background: var(--background);
      color: var(--foreground);
      font-family: ui-sans-serif, system-ui, sans-serif;
    }
    [data-testid=social-post-preview] { width: ${frame.card}px; }
  </style>
</head>
<body>${body}</body>
</html>`,
      { waitUntil: "load" },
    );
    const file = `${prefix}-${theme}-${frame.name}.png`;
    await page.locator("[data-testid=social-post-preview]").screenshot({
      path: join(outDir, file),
      type: "png",
    });
    await page.close();
    console.log(join(outDir, file));
  }
}

await browser.close();
