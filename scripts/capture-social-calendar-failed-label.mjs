import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(join(root, "apps/web/package.json"))(
  "playwright",
);

const docsDir = join(root, "docs/images/social-calendar-failed-label");
const artifactsDir = "/opt/cursor/artifacts/social-calendar-failed-label";
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

function pageHtml(theme, labeled) {
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
    .page { padding: 1.5rem; max-width: 20rem; }
    .card {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      padding: 0.375rem;
      border: 1px solid var(--border);
      border-radius: calc(var(--radius) - 2px);
      background: var(--background);
      font-size: 0.75rem;
      font-weight: 500;
    }
    .row { display: flex; align-items: center; gap: 0.25rem; min-width: 0; }
    .handle { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .time { color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
    .project, .text { color: var(--muted-foreground); font-weight: 400; }
    .text { color: var(--foreground); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .x {
      width: 0.75rem; height: 0.75rem; border-radius: 999px;
      background: #000; color: #fff; display: grid; place-items: center;
      font-size: 0.5rem; font-weight: 700;
    }
    html.dark .x { background: #fff; color: #000; }
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.375rem;
      border-radius: 0.125rem;
      font-size: 0.75rem;
      font-weight: 500;
      background: var(--semantic-destructive-solid);
      color: var(--semantic-destructive-foreground);
      border: 1px solid transparent;
    }
    .badge.icon { width: 1.25rem; height: 1.25rem; padding: 0; }
    .badge.label { padding: 0.25rem 0.625rem; }
    .mark {
      width: 0.75rem; height: 0.75rem; border-radius: 999px;
      border: 2px solid currentColor; position: relative;
    }
    .mark::after {
      content: "";
      position: absolute; inset: 0.15rem;
      background: currentColor;
      clip-path: polygon(20% 0, 0 20%, 30% 50%, 0 80%, 20% 100%, 50% 70%, 80% 100%, 100% 80%, 70% 50%, 100% 20%, 80% 0, 50% 30%);
    }
  </style>
</head>
<body>
  <div class="page">
    <article class="card">
      <span class="row">
        <span class="x" aria-hidden>X</span>
        <span class="handle">@sokosumi</span>
        <span class="time">10:00 AM</span>
      </span>
      <span class="project">Launch</span>
      <span class="text">Failed text</span>
      <span class="row">
        <span class="badge ${labeled ? "label" : "icon"}">
          <span class="mark" aria-hidden></span>
          ${labeled ? "Failed" : ""}
        </span>
      </span>
    </article>
  </div>
</body>
</html>`;
}

const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  for (const [name, labeled] of [
    ["before", false],
    ["after", true],
  ]) {
    const page = await browser.newPage({
      viewport: { width: 480, height: 280 },
    });
    await page.setContent(pageHtml(theme, labeled), {
      waitUntil: "networkidle",
    });
    await page.evaluate(() => document.fonts.ready);
    const file = `${name}-${theme}-desktop.png`;
    const buffer = await page.locator(".card").screenshot({ type: "png" });
    writeFileSync(join(docsDir, file), buffer);
    writeFileSync(join(artifactsDir, file), buffer);
    await page.close();
  }
}
await browser.close();
console.log(`wrote ${docsDir}`);
