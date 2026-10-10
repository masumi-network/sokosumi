import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(join(root, "apps/web/package.json"))(
  "playwright",
);

const docsDir = join(root, "docs/images/social-retry-dialog");
const artifactsDir = "/opt/cursor/artifacts/social-retry-dialog";
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

const COPY = {
  before: {
    title: "Publish this post now?",
    description:
      "The post goes out right away instead of waiting for its scheduled time.",
    confirm: "Publish now",
  },
  after: {
    title: "Retry this post?",
    description: "The post goes out now.",
    confirm: "Retry",
  },
};

function pageHtml(theme, copy) {
  return `<!DOCTYPE html>
<html lang="en" class="${theme}">
<head>
  <meta charset="utf-8" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    ${themeBlock(":root")}
    ${themeBlock(".dark")}
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, system-ui, sans-serif;
      background: var(--muted);
      color: var(--foreground);
    }
    .page { padding: 2rem; max-width: 42rem; margin: 0 auto; }
    .row {
      display: flex;
      gap: 0.75rem;
      padding: 0.75rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--background);
    }
    .badge {
      font-size: 0.75rem;
      font-weight: 500;
      padding: 0.25rem 0.625rem;
      border-radius: 0.25rem;
      border: 1px solid var(--border);
    }
    .meta { color: var(--muted-foreground); font-size: 0.875rem; }
    .error { color: var(--semantic-destructive); font-size: 0.75rem; }
    .retry {
      margin-left: auto;
      height: 2rem;
      padding: 0 0.75rem;
      border-radius: 0.375rem;
      border: 1px solid var(--input);
      background: var(--background);
      font: inherit;
      font-size: 0.875rem;
    }
    .overlay {
      position: fixed;
      inset: 0;
      display: grid;
      place-items: center;
      background: var(--overlay);
      backdrop-filter: blur(16px);
    }
    [data-slot="alert-dialog-content"] {
      width: min(32rem, calc(100% - 2rem));
      display: grid;
      gap: 1rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--background);
      padding: 1.5rem;
      box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
    }
    [data-slot="alert-dialog-title"] {
      margin: 0;
      font-size: 1.125rem;
      line-height: 1.75rem;
      font-weight: 600;
    }
    [data-slot="alert-dialog-description"] {
      margin: 0.5rem 0 0;
      color: var(--muted-foreground);
      font-size: 0.875rem;
      line-height: 1.25rem;
    }
    [data-slot="alert-dialog-footer"] {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
    }
    button { font: inherit; cursor: default; }
    .cancel, .confirm {
      height: 2.5rem;
      padding: 0 1rem;
      border-radius: 0.375rem;
      border: 1px solid transparent;
    }
    .cancel {
      background: var(--background);
      color: var(--foreground);
      border-color: var(--input);
    }
    .confirm {
      background: var(--secondary);
      color: var(--secondary-foreground);
    }
  </style>
</head>
<body>
  <div class="page">
    <article class="row">
      <div>
        <p class="meta"><span class="badge">Failed</span> Sep 10, 10:00 AM UTC · @sokosumi</p>
        <p>Failed text</p>
        <p class="error">X rejected the post (403 forbidden)</p>
      </div>
      <button type="button" class="retry">Retry</button>
    </article>
  </div>
  <div class="overlay">
    <div role="alertdialog" aria-modal="true" data-slot="alert-dialog-content">
      <div>
        <h2 data-slot="alert-dialog-title">${copy.title}</h2>
        <p data-slot="alert-dialog-description">${copy.description}</p>
      </div>
      <div data-slot="alert-dialog-footer">
        <button type="button" class="cancel">Close</button>
        <button type="button" class="confirm">${copy.confirm}</button>
      </div>
    </div>
  </div>
</body>
</html>`;
}

const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  for (const [name, copy] of Object.entries(COPY)) {
    const page = await browser.newPage({
      viewport: { width: 960, height: 540 },
    });
    await page.setContent(pageHtml(theme, copy), {
      waitUntil: "networkidle",
    });
    const file = `${name}-${theme}-desktop.png`;
    const buffer = await page.screenshot({ type: "png" });
    writeFileSync(join(docsDir, file), buffer);
    writeFileSync(join(artifactsDir, file), buffer);
    await page.close();
  }
}
await browser.close();
console.log(`wrote ${docsDir}`);
