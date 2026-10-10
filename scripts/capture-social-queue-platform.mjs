import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(join(root, "apps/web/package.json"))(
  "playwright",
);

const docsDir = join(root, "docs/images/social-queue-platform");
const artifactsDir = "/opt/cursor/artifacts/social-queue-platform";
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

function row(kind) {
  const linkedin = kind === "linkedin";
  return `<article class="row">
    <div class="icon">${linkedin ? "in" : "X"}</div>
    <div>
      <p class="meta"><span class="badge">Draft</span> @${linkedin ? "company" : "sokosumi"}</p>
      <p class="text">${linkedin ? "LinkedIn draft" : "Draft text"}</p>
    </div>
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
    .page { padding: 1.25rem; width: 28rem; }
    .bar { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; }
    .tabs {
      display: flex; gap: 0.25rem; padding: 0.2rem; border-radius: 0.5rem;
      background: var(--muted); font-size: 0.875rem;
    }
    .tab { padding: 0.35rem 0.65rem; border-radius: 0.375rem; }
    .tab.on { background: var(--background); font-weight: 500; }
    .filter {
      margin-left: auto; height: 2rem; padding: 0 0.75rem; border-radius: 0.375rem;
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
    .row {
      display: flex; gap: 0.75rem; padding: 0.75rem; margin-bottom: 0.5rem;
      border: 1px solid var(--border); border-radius: var(--radius);
      background: var(--background);
    }
    .icon {
      width: 2.25rem; height: 2.25rem; border: 1px solid var(--border);
      border-radius: 0.375rem; display: grid; place-items: center;
      font-size: 0.7rem; font-weight: 700;
    }
    .meta { color: var(--muted-foreground); font-size: 0.875rem; margin: 0; }
    .badge {
      display: inline-block; margin-right: 0.4rem; padding: 0.1rem 0.45rem;
      border: 1px solid var(--border); border-radius: 0.125rem;
      font-size: 0.75rem; color: var(--foreground);
    }
    .text { margin: 0.35rem 0 0; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="page">
    <div class="bar">
      <div class="tabs">
        <span class="tab on">Drafts 2</span>
        <span class="tab">Statistics</span>
      </div>
      <button type="button" class="filter">Filters${filtered ? '<span class="dot"></span>' : ""}</button>
    </div>
    ${
      filtered
        ? `<div class="menu">
      <div class="item">All</div>
      <div class="item">X</div>
      <div class="item active">LinkedIn</div>
    </div>`
        : ""
    }
    ${filtered ? row("linkedin") : `${row("x")}${row("linkedin")}`}
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
      viewport: { width: 560, height: 420 },
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
