import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "apps/web/docs/images/social-edit-failed");
mkdirSync(outDir, { recursive: true });
mkdirSync("/tmp/social-edit-failed", { recursive: true });

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
     writeFileSync("/tmp/social-edit-failed/preview.css", result.css);`,
  ],
  { cwd: join(root, "apps/web") },
);

const viewports = {
  desktop: { width: 960, height: 720 },
  phone: { width: 390, height: 844 },
};

const cases = ["before-failed", "after-failed", "after-composer"];

for (const caseName of cases) {
  const markup = execFileSync(
    "pnpm",
    ["exec", "tsx", "scripts/render-social-edit-failed.tsx", caseName],
    { cwd: join(root, "apps/web"), encoding: "utf8" },
  );

  for (const theme of ["light", "dark"]) {
    for (const [viewportName, viewport] of Object.entries(viewports)) {
      if (caseName === "after-composer" && viewportName === "phone") continue;
      const htmlPath = `/tmp/social-edit-failed/${caseName}-${theme}-${viewportName}.html`;
      const pngPath = join(outDir, `${caseName}-${theme}-${viewportName}.png`);
      writeFileSync(
        htmlPath,
        `<!doctype html>
<html lang="en" class="${theme === "dark" ? "dark" : ""}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="stylesheet" href="preview.css" />
          <style>
            html, body { margin: 0; min-height: 100%; }
            body {
              background: var(--background);
              color: var(--foreground);
              font-family: ui-sans-serif, system-ui, sans-serif;
            }
          </style>
</head>
<body>${markup}</body>
</html>`,
      );
      const profile = `/tmp/social-edit-failed/chrome-${theme}-${viewportName}`;
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
