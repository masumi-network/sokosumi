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
const outDir = join(root, "apps/web/docs/images/social-calendar-gif-badge");
mkdirSync(outDir, { recursive: true });
mkdirSync("/tmp/social-calendar-gif-badge", { recursive: true });

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
     writeFileSync("/tmp/social-calendar-gif-badge/preview.css", result.css);`,
  ],
  { cwd: join(root, "apps/web") },
);

const css = readFileSync("/tmp/social-calendar-gif-badge/preview.css", "utf8");
const body = execFileSync(
  "pnpm",
  ["exec", "tsx", "scripts/render-social-calendar-gif-badge.tsx", prefix],
  { cwd: join(root, "apps/web"), encoding: "utf8" },
);

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome-stable",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

for (const theme of ["light", "dark"]) {
  const page = await browser.newPage({
    viewport: { width: 420, height: 420 },
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
      width: 420px;
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
  await page.locator("[data-testid=calendar-gif-badge]").screenshot({
    path: join(outDir, `${prefix}-${theme}.png`),
    type: "png",
  });
  await page.close();
  console.log(join(outDir, `${prefix}-${theme}.png`));
}

await browser.close();
