import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "apps/web/docs/images/social-preview-dialog-failure");
const prefix = process.argv[2] ?? "after";

mkdirSync(outDir, { recursive: true });
mkdirSync("/tmp/social-preview-dialog", { recursive: true });

const markup = execFileSync(
  "pnpm",
  ["exec", "tsx", "scripts/render-social-post-preview-dialog.tsx", prefix],
  { cwd: join(root, "apps/web"), encoding: "utf8" },
);

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
     writeFileSync("/tmp/social-preview-dialog/preview.css", result.css);`,
  ],
  { cwd: join(root, "apps/web") },
);

const shots = [
  { theme: "light", width: 468, height: 640, suffix: "desktop" },
  { theme: "dark", width: 468, height: 640, suffix: "desktop" },
  { theme: "light", width: 399, height: 720, suffix: "mobile" },
];

for (const shot of shots) {
  const htmlPath = `/tmp/social-preview-dialog/${prefix}-${shot.theme}-${shot.suffix}.html`;
  const pngPath = join(outDir, `${prefix}-${shot.theme}-${shot.suffix}.png`);
  writeFileSync(
    htmlPath,
    `<!doctype html>
<html lang="en" class="${shot.theme === "dark" ? "dark" : ""}">
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="preview.css" />
  <style>
    html, body { margin: 0; }
    body {
      width: ${shot.width}px;
      min-height: 100vh;
      padding: 24px;
      background: var(--muted);
      color: var(--foreground);
      font-family: ui-sans-serif, system-ui, sans-serif;
      word-spacing: normal;
    }
    body, body * {
      font-family: ui-sans-serif, system-ui, sans-serif !important;
    }
  </style>
</head>
<body>${markup}</body>
</html>`,
  );
  const profile = `/tmp/social-preview-dialog/chrome-${shot.theme}-${shot.suffix}`;
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
      `--window-size=${shot.width},${shot.height}`,
      `--screenshot=${pngPath}`,
      `file://${htmlPath}`,
    ],
    { timeout: 30_000, stdio: "inherit" },
  );
  console.log(pngPath);
}
