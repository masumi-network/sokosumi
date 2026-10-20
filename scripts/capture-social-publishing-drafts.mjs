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
const outDir = join(root, "apps/web/docs/images/social-publishing-drafts");
mkdirSync(outDir, { recursive: true });
mkdirSync("/tmp/social-publishing-drafts", { recursive: true });

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
     writeFileSync("/tmp/social-publishing-drafts/preview.css", result.css);`,
  ],
  { cwd: join(root, "apps/web") },
);

const css = readFileSync("/tmp/social-publishing-drafts/preview.css", "utf8");
const body = execFileSync(
  "pnpm",
  ["exec", "tsx", "scripts/render-social-publishing-drafts.tsx", prefix],
  { cwd: join(root, "apps/web"), encoding: "utf8" },
);

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome-stable",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

for (const theme of ["light", "dark"]) {
  const page = await browser.newPage({
    viewport: { width: 720, height: 520 },
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
      width: 720px;
      padding: 24px;
      background: var(--background);
      color: var(--foreground);
      font-family: ui-sans-serif, system-ui, sans-serif;
    }
  </style>
</head>
<body>${body}</body>
</html>`,
    { waitUntil: "load" },
  );
  const file = `${prefix}-${theme}.png`;
  await page.locator("[data-testid=publishing-drafts]").screenshot({
    path: join(outDir, file),
    type: "png",
  });
  await page.close();
  console.log(join(outDir, file));
}

await browser.close();
