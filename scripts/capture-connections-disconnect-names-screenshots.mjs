import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { chromium } = require("playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(root, "docs/images/connections-disconnect-names");
const artifactsDir = "/opt/cursor/artifacts/connections-disconnect-names";
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
    card: dark ? "#1c1c1c" : "#ffffff",
    overlay: dark ? "rgb(0 0 0 / 0.6)" : "rgb(0 0 0 / 0.4)",
  };
}

function page(theme, variant) {
  const t = tokens(theme);
  const after = variant === "after";
  const title = after ? "Disconnect Google" : "Disconnect google";
  const body = after
    ? "Are you sure you want to disconnect your Google account?"
    : "Are you sure you want to disconnect your google account?";

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
  <div id="shot" style="position:relative;max-width:720px;margin:0 auto;min-height:360px;background:${t.bg};">
    <div style="position:absolute;inset:0;background:${t.overlay};"></div>
    <div style="
      position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
      width:min(420px,calc(100% - 32px));background:${t.card};
      border:1px solid ${t.border};border-radius:12px;padding:24px;text-align:center;
    ">
      <h2 style="margin:0 0 8px;font:500 18px/24px ui-sans-serif,system-ui,sans-serif;">${title}</h2>
      <p style="margin:0 0 20px;color:${t.muted};font:400 16px/24px ui-sans-serif,system-ui,sans-serif;">${body}</p>
      <div style="display:flex;justify-content:center;gap:8px;">
        <button type="button" style="
          border:0;background:${t.fg};color:${t.bg};border-radius:8px;
          padding:8px 14px;font:500 14px/20px ui-sans-serif,system-ui,sans-serif;
        ">Disconnect</button>
        <button type="button" style="
          border:1px solid ${t.border};background:${t.card};color:${t.fg};border-radius:8px;
          padding:8px 14px;font:500 14px/20px ui-sans-serif,system-ui,sans-serif;
        ">Cancel</button>
      </div>
    </div>
  </div>
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
