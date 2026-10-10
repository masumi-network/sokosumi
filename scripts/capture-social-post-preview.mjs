import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.argv[2]
  ? join(root, process.argv[2])
  : join(root, "docs/images/social-post-previews");
const caseName = process.argv[3] ?? "facebook";
const prefix = process.argv[4] ?? "before";

mkdirSync(outDir, { recursive: true });
mkdirSync("/tmp/social-preview", { recursive: true });

const markup = execFileSync(
  "pnpm",
  ["exec", "tsx", "scripts/render-social-post-preview.tsx", caseName],
  { cwd: join(root, "apps/web"), encoding: "utf8" },
);

const css = execFileSync(
  "node",
  [
    "--input-type=module",
    "-e",
    `import postcss from "postcss";
     import tailwind from "@tailwindcss/postcss";
     import { readFileSync, writeFileSync } from "fs";
     const css = readFileSync("src/app/globals.css", "utf8");
     const result = await postcss([tailwind()]).process(css, { from: "src/app/globals.css" });
     writeFileSync("/tmp/social-preview/preview.css", result.css);`,
  ],
  { cwd: join(root, "apps/web") },
);

void css;

for (const theme of ["light", "dark"]) {
  const htmlPath = `/tmp/social-preview/${prefix}-${caseName}-${theme}.html`;
  const pngPath = join(outDir, `${prefix}-${caseName}-${theme}.png`);
  writeFileSync(
    htmlPath,
    `<!doctype html>
<html lang="en" class="${theme === "dark" ? "dark" : ""}">
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="preview.css" />
  <style>
    html, body { margin: 0; }
    body {
      width: 420px;
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
  const profile = `/tmp/social-preview/chrome-${theme}`;
  mkdirSync(profile, { recursive: true });
  execFileSync(
    "/usr/bin/google-chrome-stable",
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--no-first-run",
      "--force-device-scale-factor=2",
      `--user-data-dir=${profile}`,
      "--window-size=468,720",
      `--screenshot=${pngPath}`,
      `file://${htmlPath}`,
    ],
    { timeout: 30_000, stdio: "inherit" },
  );
  console.log(pngPath);
}
