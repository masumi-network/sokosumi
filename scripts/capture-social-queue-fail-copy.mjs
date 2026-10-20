import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(join(root, "apps/web/package.json"))(
  "playwright",
);

const docsDir = join(root, "apps/web/docs/images/social-queue-fail-copy");
const artifactsDir = "/opt/cursor/artifacts/social-queue-fail-copy";
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

function pageHtml(theme, reason) {
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
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, sans-serif;
      background: var(--muted);
      color: var(--foreground);
    }
    .page { padding: 1.5rem; }
    .queue-row {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      width: 36rem;
      padding: 0.75rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--background);
    }
    .logo {
      width: 2.25rem;
      height: 2.25rem;
      border: 1px solid var(--border);
      border-radius: 0.375rem;
      display: grid;
      place-items: center;
      flex-shrink: 0;
      background: var(--background);
    }
    .x {
      width: 1.25rem;
      height: 1.25rem;
      border-radius: 999px;
      background: #000;
      color: #fff;
      display: grid;
      place-items: center;
      font-size: 0.625rem;
      font-weight: 700;
    }
    html.dark .x { background: #fff; color: #000; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      font-size: 0.75rem;
      font-weight: 500;
      padding: 0.25rem 0.625rem;
      border-radius: 0.125rem;
      background: var(--semantic-destructive-solid);
      color: var(--semantic-destructive-foreground);
    }
    .mark {
      width: 0.75rem;
      height: 0.75rem;
      border-radius: 999px;
      border: 2px solid currentColor;
      position: relative;
    }
    .mark::after {
      content: "";
      position: absolute;
      inset: 0.15rem;
      background: currentColor;
      clip-path: polygon(20% 0, 0 20%, 30% 50%, 0 80%, 20% 100%, 50% 70%, 80% 100%, 100% 80%, 70% 50%, 100% 20%, 80% 0, 50% 30%);
    }
    .meta {
      color: var(--muted-foreground);
      font-size: 0.875rem;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
      min-height: 2.25rem;
    }
    .time { color: var(--foreground); font-weight: 500; font-variant-numeric: tabular-nums; }
    .text { margin: 0.25rem 0 0; font-size: 0.875rem; }
    .error { color: var(--semantic-destructive); font-size: 0.75rem; margin: 0.25rem 0 0; }
    .failed-at { color: var(--muted-foreground); font-size: 0.75rem; margin: 0.125rem 0 0; }
    .retry {
      margin-left: auto;
      height: 2rem;
      padding: 0 0.75rem;
      border-radius: 0.375rem;
      border: 1px solid var(--input);
      background: var(--background);
      color: var(--foreground);
      font: inherit;
      font-size: 0.875rem;
    }
    p { margin: 0; }
  </style>
</head>
<body>
  <div class="page">
    <article class="queue-row">
      <div class="logo" aria-hidden><span class="x">X</span></div>
      <div>
        <p class="meta">
          <span class="badge"><span class="mark" aria-hidden></span>Failed</span>
          <span class="time">Sep 10, 10:00 AM UTC</span>
          <span>@sokosumi</span>
        </p>
        <p class="text">Failed text</p>
        <p class="error">${reason}</p>
        <p class="failed-at">Failed Sep 10, 10:05 AM</p>
      </div>
      <button type="button" class="retry">Retry</button>
    </article>
  </div>
</body>
</html>`;
}

const browser = await chromium.launch();
const shots = {
  before: "X rejected the post (403 forbidden)",
  after: "The platform rejected this post.",
};
for (const theme of ["light", "dark"]) {
  for (const [name, reason] of Object.entries(shots)) {
    const page = await browser.newPage({
      viewport: { width: 960, height: 320 },
    });
    await page.setContent(pageHtml(theme, reason), { waitUntil: "load" });
    const file = `${name}-${theme}-desktop.png`;
    const buffer = await page.locator(".queue-row").screenshot({ type: "png" });
    writeFileSync(join(docsDir, file), buffer);
    writeFileSync(join(artifactsDir, file), buffer);
    await page.close();
  }
}
await browser.close();
console.log(`wrote ${docsDir}`);
