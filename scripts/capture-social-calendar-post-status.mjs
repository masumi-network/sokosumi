import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(join(root, "apps/web/package.json"))(
  "playwright",
);

const docsDir = join(root, "docs/images/social-calendar-post-status");
const artifactsDir = "/opt/cursor/artifacts/social-calendar-post-status";
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

function card(kind) {
  const failed = kind === "failed";
  return `<article class="card">
    <span class="row">
      <span class="x">X</span>
      <span class="handle">@sokosumi</span>
      <span class="time">${failed ? "10:05 AM" : "10:00 AM"}</span>
    </span>
    <span class="text">${failed ? "Failed text" : "Launch news"}</span>
    <span class="badge ${failed ? "fault" : "staged"}">${failed ? "Failed" : "Scheduled"}</span>
  </article>`;
}

function pageHtml(theme, filtered) {
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
    .bar { display: flex; justify-content: flex-end; margin-bottom: 0.75rem; }
    .filter {
      height: 2rem; padding: 0 0.75rem; border-radius: 0.375rem;
      border: 1px solid var(--input); background: var(--background);
      font: inherit; font-size: 0.875rem; position: relative;
    }
    .dot {
      position: absolute; top: -0.2rem; right: -0.2rem;
      width: 0.5rem; height: 0.5rem; border-radius: 999px;
      background: var(--primary);
    }
    .menu {
      margin: -0.5rem 0 0.75rem auto; width: 12rem;
      border: 1px solid var(--border); border-radius: var(--radius);
      background: var(--background); padding: 0.25rem; font-size: 0.875rem;
    }
    .item { padding: 0.4rem 0.5rem; border-radius: 0.25rem; }
    .item.active { background: var(--accent); }
    .card {
      display: flex; flex-direction: column; gap: 0.25rem;
      padding: 0.375rem; margin-bottom: 0.5rem;
      border: 1px solid var(--border); border-radius: 0.375rem;
      background: var(--background); font-size: 0.75rem; font-weight: 500;
    }
    .row { display: flex; align-items: center; gap: 0.25rem; }
    .handle { flex: 1; }
    .time { color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
    .text { font-weight: 400; }
    .x {
      width: 0.75rem; height: 0.75rem; border-radius: 999px;
      background: #000; color: #fff; display: grid; place-items: center;
      font-size: 0.5rem; font-weight: 700;
    }
    html.dark .x { background: #fff; color: #000; }
    .badge {
      display: inline-flex; width: fit-content;
      padding: 0.15rem 0.5rem; border-radius: 0.125rem; font-weight: 500;
    }
    .badge.staged {
      background: var(--status-queued-quaternary, var(--muted));
      color: var(--foreground);
      border: 1px solid var(--border);
    }
    .badge.fault {
      background: var(--semantic-destructive-solid);
      color: var(--semantic-destructive-foreground);
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="bar">
      <button type="button" class="filter">Filters${filtered ? '<span class="dot"></span>' : ""}</button>
    </div>
    ${
      filtered
        ? `<div class="menu">
      <div class="item">All</div>
      <div class="item">Scheduled</div>
      <div class="item active">Failed</div>
      <div class="item">Published</div>
    </div>`
        : ""
    }
    ${filtered ? card("failed") : `${card("scheduled")}${card("failed")}`}
  </div>
</body>
</html>`;
}

const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  for (const [name, filtered] of [
    ["before", false],
    ["after", true],
  ]) {
    const page = await browser.newPage({
      viewport: { width: 480, height: 420 },
    });
    await page.setContent(pageHtml(theme, filtered), { waitUntil: "load" });
    const file = `${name}-${theme}-desktop.png`;
    const buffer = await page.locator(".page").screenshot({ type: "png" });
    writeFileSync(join(docsDir, file), buffer);
    writeFileSync(join(artifactsDir, file), buffer);
    await page.close();
  }
}
await browser.close();
console.log(`wrote ${docsDir}`);
