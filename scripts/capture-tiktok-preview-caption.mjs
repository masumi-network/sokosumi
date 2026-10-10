import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(join(root, "apps/web/package.json"))(
  "playwright",
);

const outDir = join(root, "apps/web/docs/images/tiktok-preview-caption");
const prefix = process.argv[2] ?? "after";

mkdirSync(outDir, { recursive: true });
mkdirSync("/tmp/tiktok-preview-caption", { recursive: true });

const markup = execFileSync(
  "pnpm",
  ["exec", "tsx", "scripts/render-tiktok-preview-caption.tsx"],
  { cwd: join(root, "apps/web"), encoding: "utf8" },
);

const css = execFileSync(
  "node",
  [
    "--input-type=module",
    "-e",
    `import postcss from "postcss";
     import tailwind from "@tailwindcss/postcss";
     import { readFileSync } from "fs";
     const css = readFileSync("src/app/globals.css", "utf8");
     const result = await postcss([tailwind()]).process(css, { from: "src/app/globals.css" });
     process.stdout.write(result.css);`,
  ],
  {
    cwd: join(root, "apps/web"),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  },
);

const shots = [
  { theme: "light", width: 468, height: 720, suffix: "desktop" },
  { theme: "dark", width: 468, height: 720, suffix: "desktop" },
  { theme: "light", width: 399, height: 760, suffix: "mobile" },
];

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome-stable",
});

for (const shot of shots) {
  const page = await browser.newPage({
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: 2,
  });
  await page.setContent(
    `<!doctype html>
<html lang="en" class="${shot.theme === "dark" ? "dark" : ""}">
<head>
  <meta charset="utf-8" />
  <style>${css}
    html, body { margin: 0; }
    body {
      width: ${shot.width}px;
      min-height: 100vh;
      padding: 24px;
      background: var(--background);
      color: var(--foreground);
      font-family: ui-sans-serif, system-ui, sans-serif;
    }
  </style>
</head>
<body>${markup}</body>
</html>`,
    { waitUntil: "networkidle" },
  );
  const file = `${prefix}-${shot.theme}-${shot.suffix}.png`;
  const buffer = await page.screenshot({ type: "png" });
  writeFileSync(join(outDir, file), buffer);
  console.log(join(outDir, file));
  await page.close();
}

await browser.close();
