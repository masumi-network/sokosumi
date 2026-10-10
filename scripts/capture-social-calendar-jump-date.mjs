import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(join(root, "apps/web/package.json"))(
  "playwright",
);

const docsDir = join(root, "docs/images/social-calendar-jump-date");
const artifactsDir = "/opt/cursor/artifacts/social-calendar-jump-date";
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

function pageHtml(theme, jumped) {
  const month = jumped ? "October 2026" : "September 2026";
  const cell = jumped
    ? `<div class="day on"><div class="num">1</div>
        <button class="chip" type="button">10:00 AM X post</button></div>
       <div class="day"><div class="num">2</div></div>`
    : `<div class="day"><div class="num">20</div></div>
       <div class="day"><div class="num">21</div></div>`;
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
    .page { padding: 1.25rem; width: 22rem; }
    .tabs {
      display: flex; gap: 0.25rem; padding: 0.2rem; margin-bottom: 0.75rem;
      border-radius: 0.5rem; background: var(--muted); font-size: 0.875rem;
      width: fit-content;
    }
    .tab { padding: 0.35rem 0.65rem; border-radius: 0.375rem; }
    .tab.on { background: var(--background); font-weight: 500; }
    .toast {
      margin-bottom: 0.75rem; padding: 0.5rem 0.75rem; border-radius: 0.5rem;
      background: var(--background); border: 1px solid var(--border);
      font-size: 0.875rem;
    }
    .head { font-size: 0.875rem; font-weight: 500; margin-bottom: 0.5rem; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; }
    .day {
      min-height: 4.5rem; padding: 0.4rem; border-radius: var(--radius);
      border: 1px solid var(--border); background: var(--background);
    }
    .day.on { border-color: var(--primary); }
    .num { font-size: 0.75rem; color: var(--muted-foreground); margin-bottom: 0.25rem; }
    .chip {
      display: block; width: 100%; text-align: left; font: inherit;
      font-size: 0.75rem; padding: 0.2rem 0.35rem; border-radius: 0.25rem;
      border: 1px solid var(--border); background: var(--background);
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="tabs">
      <span class="tab on">Calendar</span>
      <span class="tab">Drafts</span>
    </div>
    <p class="toast">Post scheduled.</p>
    <div class="head">${month}</div>
    <div class="grid">${cell}</div>
  </div>
</body>
</html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 360 } });

for (const [name, theme, jumped] of [
  ["before-light-desktop", "", false],
  ["before-dark-desktop", "dark", false],
  ["after-light-desktop", "", true],
  ["after-dark-desktop", "dark", true],
]) {
  await page.setContent(pageHtml(theme, jumped));
  const shot = await page.screenshot({ type: "png" });
  writeFileSync(join(docsDir, `${name}.png`), shot);
  writeFileSync(join(artifactsDir, `${name}.png`), shot);
}

await browser.close();
