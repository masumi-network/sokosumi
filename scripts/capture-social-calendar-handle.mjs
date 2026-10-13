import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(join(root, "apps/web/package.json"))(
  "playwright",
);

const docsDir = join(root, "docs/images/social-calendar-handle");
const artifactsDir = "/opt/cursor/artifacts/social-calendar-handle";
mkdirSync(docsDir, { recursive: true });
mkdirSync(artifactsDir, { recursive: true });

const globals = readFileSync(
  join(root, "apps/web/src/app/globals.css"),
  "utf8",
);

function themeBlock(label) {
  const start = globals.indexOf(`${label} {`);
  const end = globals.indexOf("\n}", start);
  return globals.slice(start, end + 2);
}

function pageHtml(theme, doubled) {
  const handle = doubled ? "@@alice" : "@alice";
  return `<!DOCTYPE html>
<html lang="en" class="${theme}">
<head>
  <meta charset="utf-8" />
  <style>
    ${themeBlock(":root")}
    ${themeBlock(".dark")}
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, sans-serif;
      background: var(--muted);
      color: var(--foreground);
    }
    .page { padding: 1.25rem; width: 18rem; }
    .card {
      display: flex; flex-direction: column; gap: 0.25rem;
      padding: 0.4rem; border-radius: 0.375rem;
      border: 1px solid var(--border); background: var(--background);
      font-size: 0.75rem; font-weight: 500;
    }
    .row { display: flex; align-items: center; gap: 0.25rem; }
    .icon {
      width: 1rem; height: 1rem; border-radius: 0.2rem;
      background: var(--tertiary); font-size: 0.55rem;
      display: flex; align-items: center; justify-content: center;
    }
    .handle { flex: 1; overflow: hidden; text-overflow: ellipsis; }
    .time { color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
    .project { color: var(--muted-foreground); font-weight: 400; }
    .text { font-weight: 400; }
  </style>
</head>
<body>
  <div class="page">
    <div class="card">
      <div class="row">
        <span class="icon">YT</span>
        <span class="handle">${handle}</span>
        <span class="time">3:00 PM</span>
      </div>
      <div class="project">Launch project</div>
      <div class="text">New video is up</div>
    </div>
  </div>
</body>
</html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 360, height: 240 } });

for (const [name, theme, doubled] of [
  ["before-light-desktop", "", true],
  ["before-dark-desktop", "dark", true],
  ["after-light-desktop", "", false],
  ["after-dark-desktop", "dark", false],
]) {
  await page.setContent(pageHtml(theme, doubled));
  const shot = await page.screenshot({ type: "png" });
  writeFileSync(join(docsDir, `${name}.png`), shot);
  writeFileSync(join(artifactsDir, `${name}.png`), shot);
}

await browser.close();
