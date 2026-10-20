import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(join(root, "apps/web/package.json"))(
  "playwright",
);

const docsDir = join(root, "docs/images/social-failed-row-time");
const artifactsDir = "/opt/cursor/artifacts/social-failed-row-time";
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

function pageHtml(theme, after) {
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
    .page { padding: 1.5rem; }
    .row {
      display: flex;
      gap: 0.75rem;
      padding: 0.75rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--background);
      max-width: 36rem;
    }
    .icon {
      width: 2.25rem; height: 2.25rem; border: 1px solid var(--border);
      border-radius: 0.375rem; display: grid; place-items: center;
      font-size: 0.75rem; font-weight: 700; flex-shrink: 0;
    }
    .meta {
      color: var(--muted-foreground);
      font-size: 0.875rem;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
    }
    .when { color: var(--foreground); font-weight: 500; font-variant-numeric: tabular-nums; }
    .badge {
      display: inline-flex; align-items: center; gap: 0.375rem;
      padding: 0.25rem 0.625rem; border-radius: 0.125rem;
      background: var(--semantic-destructive-solid);
      color: var(--semantic-destructive-foreground);
      font-size: 0.75rem; font-weight: 500;
    }
    .text { margin: 0.375rem 0 0; font-size: 0.875rem; }
    .error { margin: 0.25rem 0 0; color: var(--semantic-destructive); font-size: 0.75rem; }
    .failed-at { margin: 0.125rem 0 0; color: var(--muted-foreground); font-size: 0.75rem; }
    .sub { margin: 0.25rem 0 0; color: var(--muted-foreground); font-size: 0.75rem; }
    .retry {
      margin-left: auto; height: 2rem; padding: 0 0.75rem;
      border-radius: 0.375rem; border: 1px solid var(--input);
      background: var(--background); font: inherit; font-size: 0.875rem;
    }
  </style>
</head>
<body>
  <div class="page">
    <article class="row">
      <div class="icon">X</div>
      <div>
        <p class="meta">
          <span class="badge">Failed</span>
          <time class="when">${after ? "Sep 10, 10:05 AM UTC" : "Sep 10, 10:00 AM UTC"}</time>
          <span>@sokosumi</span>
        </p>
        <p class="text">Failed text</p>
        <p class="sub">User · Ada · 3 attempts</p>
        <p class="error">X rejected the post (403 forbidden)</p>
        ${after ? "" : '<p class="failed-at">Failed Sep 10, 10:05 AM</p>'}
      </div>
      <button type="button" class="retry">Retry</button>
    </article>
  </div>
</body>
</html>`;
}

const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  for (const [name, after] of [
    ["before", false],
    ["after", true],
  ]) {
    const page = await browser.newPage({
      viewport: { width: 800, height: 280 },
    });
    await page.setContent(pageHtml(theme, after), { waitUntil: "load" });
    const file = `${name}-${theme}-desktop.png`;
    const buffer = await page.locator(".row").screenshot({ type: "png" });
    writeFileSync(join(docsDir, file), buffer);
    writeFileSync(join(artifactsDir, file), buffer);
    await page.close();
  }
}
await browser.close();
console.log(`wrote ${docsDir}`);
