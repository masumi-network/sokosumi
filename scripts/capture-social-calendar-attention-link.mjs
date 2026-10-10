import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(join(root, "apps/web/package.json"))(
  "playwright",
);

const docsDir = join(root, "docs/images/social-calendar-attention-link");
const artifactsDir = "/opt/cursor/artifacts/social-calendar-attention-link";
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

function pageHtml(theme, attention) {
  const tabs = attention
    ? `<span class="tab">Calendar</span><span class="tab on">Needs attention 1</span><span class="tab">Drafts</span>`
    : `<span class="tab on">Calendar</span><span class="tab">Drafts</span>`;
  const body = attention
    ? `<article class="row">
        <span class="badge fail">Failed</span>
        <span class="text">Launch news</span>
      </article>`
    : `<div class="day"><div class="num">10</div>
        <button class="chip" type="button">3:00 PM X post</button></div>`;
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
    .day {
      border: 1px solid var(--border); border-radius: var(--radius);
      background: var(--background); padding: 0.5rem;
    }
    .num { font-size: 0.75rem; color: var(--muted-foreground); margin-bottom: 0.35rem; }
    .chip {
      display: block; width: 100%; text-align: left; font: inherit;
      font-size: 0.75rem; padding: 0.25rem 0.4rem; border-radius: 0.25rem;
      border: 1px solid var(--border); background: var(--background);
    }
    .row {
      display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem;
      border: 1px solid var(--border); border-radius: var(--radius);
      background: var(--background); font-size: 0.875rem;
    }
    .badge {
      font-size: 0.6875rem; font-weight: 500; padding: 0.1rem 0.35rem;
      border-radius: 0.25rem;
    }
    .badge.fail { background: var(--destructive); color: var(--destructive-foreground); }
  </style>
</head>
<body>
  <div class="page">
    <div class="tabs">${tabs}</div>
    ${body}
  </div>
</body>
</html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 280 } });

for (const [name, theme, attention] of [
  ["before-light-desktop", "", false],
  ["before-dark-desktop", "dark", false],
  ["after-light-desktop", "", true],
  ["after-dark-desktop", "dark", true],
]) {
  await page.setContent(pageHtml(theme, attention));
  const shot = await page.screenshot({ type: "png" });
  writeFileSync(join(docsDir, `${name}.png`), shot);
  writeFileSync(join(artifactsDir, `${name}.png`), shot);
}

await browser.close();
