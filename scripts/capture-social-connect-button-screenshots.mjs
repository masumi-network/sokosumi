import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { chromium } = require("playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(root, "docs/images/social-connect-button");
const artifactsDir = "/opt/cursor/artifacts/social-connect-button";
mkdirSync(docsDir, { recursive: true });
mkdirSync(artifactsDir, { recursive: true });

const themes = ["light", "dark"];
const viewports = [
  { name: "desktop", width: 1280, height: 720 },
  { name: "mobile", width: 375, height: 812 },
];

function tokens(theme) {
  const dark = theme === "dark";
  return {
    bg: dark ? "#121212" : "#ffffff",
    fg: dark ? "#fafafa" : "#0a0a0a",
    muted: dark ? "#b8b8b8" : "#707070",
    border: dark ? "#343434" : "#e2e2e2",
  };
}

function page(theme, variant) {
  const t = tokens(theme);
  const label =
    variant === "after" ? "Connect account" : "Connect X, YouTube, LinkedIn…";

  return `<!DOCTYPE html>
<html lang="en" class="${theme}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    html, body { margin: 0; background: ${t.bg}; color: ${t.fg};
      font-family: ui-sans-serif, system-ui, sans-serif; }
  </style>
</head>
<body>
  <section id="shot" style="max-width:960px;margin:0 auto;padding:32px 16px;">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;">
      <div>
        <h2 style="margin:0;font:600 16px/24px ui-sans-serif,system-ui,sans-serif;">Social accounts</h2>
        <p style="margin:4px 0 0;color:${t.muted};font:400 14px/20px ui-sans-serif,system-ui,sans-serif;">
          Connect social accounts to this project.
        </p>
      </div>
      <button type="button" style="
        flex-shrink:0;border:1px solid ${t.border};background:${t.bg};color:${t.fg};
        border-radius:8px;padding:6px 12px;
        font:500 14px/20px ui-sans-serif,system-ui,sans-serif;white-space:nowrap;
      ">+ ${label}</button>
    </div>
  </section>
</body>
</html>`;
}

const browser = await chromium.launch();
for (const theme of themes) {
  for (const viewport of viewports) {
    for (const variant of ["before", "after"]) {
      const pageHandle = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
      });
      await pageHandle.setContent(page(theme, variant), {
        waitUntil: "networkidle",
      });
      const name = `${variant}-${theme}-${viewport.name}.png`;
      const buffer = await pageHandle.locator("#shot").screenshot();
      writeFileSync(join(docsDir, name), buffer);
      writeFileSync(join(artifactsDir, name), buffer);
      await pageHandle.close();
    }
  }
}
await browser.close();
console.log(`wrote screenshots to ${docsDir} and ${artifactsDir}`);
