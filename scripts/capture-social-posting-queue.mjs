import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "apps/web/docs/images/social-posting-queue");
mkdirSync(outDir, { recursive: true });
mkdirSync("/tmp/social-posting-queue", { recursive: true });

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
     writeFileSync("/tmp/social-posting-queue/preview.css", result.css);`,
  ],
  { cwd: join(root, "apps/web") },
);

const viewports = {
  desktop: { width: 960, height: 860 },
  phone: { width: 390, height: 844 },
};
const tallViewports = {
  desktop: { width: 960, height: 1100 },
  phone: { width: 390, height: 1400 },
};

const cases = [
  "before-composer",
  "after-composer",
  "before-accounts",
  "after-accounts",
];

for (const caseName of cases) {
  const markup = execFileSync(
    "pnpm",
    ["exec", "tsx", "scripts/render-social-posting-queue.tsx", caseName],
    { cwd: join(root, "apps/web"), encoding: "utf8" },
  );

  const sizes = caseName.includes("accounts") ? tallViewports : viewports;
  for (const theme of ["light", "dark"]) {
    for (const [viewportName, viewport] of Object.entries(sizes)) {
      const htmlPath = `/tmp/social-posting-queue/${caseName}-${theme}-${viewportName}.html`;
      const pngPath = join(outDir, `${caseName}-${theme}-${viewportName}.png`);
      writeFileSync(
        htmlPath,
        `<!doctype html>
<html lang="en" class="${theme === "dark" ? "dark" : ""}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="preview.css" />
  <style>
    html, body { margin: 0; min-height: 100%; }
    body {
      background: var(--background);
      color: var(--foreground);
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    }
  </style>
</head>
<body>${markup}</body>
</html>`,
      );
      const profile = `/tmp/social-posting-queue/chrome-${theme}-${viewportName}`;
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
          `--window-size=${viewport.width},${viewport.height}`,
          `--screenshot=${pngPath}`,
          `file://${htmlPath}`,
        ],
        { timeout: 30_000, stdio: "inherit" },
      );
      console.log(pngPath);
    }
  }
}
