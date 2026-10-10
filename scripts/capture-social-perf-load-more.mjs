import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(join(root, "apps/web/package.json"))(
  "playwright",
);

const outDir = join(root, "apps/web/docs/images/social-perf-load-more");
mkdirSync(outDir, { recursive: true });
mkdirSync("/tmp/social-perf-load-more", { recursive: true });

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
     writeFileSync("/tmp/social-perf-load-more/preview.css", result.css);`,
  ],
  { cwd: join(root, "apps/web") },
);

const css = readFileSync("/tmp/social-perf-load-more/preview.css", "utf8");

function markup(variant) {
  return execFileSync(
    "pnpm",
    ["exec", "tsx", "scripts/render-social-perf-load-more.tsx", variant],
    { cwd: join(root, "apps/web"), encoding: "utf8" },
  );
}

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome-stable",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

for (const variant of ["before", "after"]) {
  const body = markup(variant);
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({
      viewport: { width: 720, height: 480 },
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
    const file = `${variant}-${theme}.png`;
    await page.locator("[data-testid=social-statistics]").screenshot({
      path: join(outDir, file),
      type: "png",
    });
    await page.close();
    console.log(join(outDir, file));
  }
}

await browser.close();
