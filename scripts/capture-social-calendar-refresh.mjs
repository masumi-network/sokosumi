import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(join(root, "apps/web/package.json"))(
  "playwright",
);

const docsDir = join(root, "docs/images/social-calendar-refresh");
const artifactsDir = "/opt/cursor/artifacts/social-calendar-refresh";
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

function pageHtml(theme, refreshed) {
  const chip = refreshed
    ? `<button class="chip canceled" type="button">
        <span class="time">3:00 PM</span>
        <span class="label">X post</span>
        <span class="badge canceled">Canceled</span>
      </button>`
    : `<button class="chip" type="button">
        <span class="time">3:00 PM</span>
        <span class="label">X post</span>
        <span class="badge">Scheduled</span>
      </button>`;
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
    .day {
      border: 1px solid var(--border); border-radius: var(--radius);
      background: var(--background); padding: 0.5rem;
    }
    .num { font-size: 0.75rem; color: var(--muted-foreground); margin-bottom: 0.35rem; }
    .chip {
      display: flex; align-items: center; gap: 0.35rem; width: 100%;
      padding: 0.25rem 0.4rem; border-radius: 0.25rem;
      border: 1px solid var(--border); background: var(--background);
      font: inherit; font-size: 0.75rem; text-align: left;
    }
    .time { color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
    .label { flex: 1; font-weight: 500; }
    .badge {
      font-size: 0.6875rem; font-weight: 500; padding: 0.1rem 0.35rem;
      border-radius: 0.25rem; background: var(--tertiary); color: var(--foreground);
    }
    .badge.canceled { background: var(--muted); color: var(--muted-foreground); }
  </style>
</head>
<body>
  <div class="page">
    <div class="tabs">
      <span class="tab on">Calendar</span>
      <span class="tab">Drafts</span>
    </div>
    <p class="toast">Post canceled.</p>
    <div class="day">
      <div class="num">10</div>
      ${chip}
    </div>
  </div>
</body>
</html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 360 } });

for (const [name, theme, refreshed] of [
  ["before-light-desktop", "", false],
  ["before-dark-desktop", "dark", false],
  ["after-light-desktop", "", true],
  ["after-dark-desktop", "dark", true],
]) {
  await page.setContent(pageHtml(theme, refreshed));
  const shot = await page.screenshot({ type: "png" });
  writeFileSync(join(docsDir, `${name}.png`), shot);
  writeFileSync(join(artifactsDir, `${name}.png`), shot);
}

await browser.close();
