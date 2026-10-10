import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { chromium } = require("playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(root, "docs/images/connections-provider-names");
const artifactsDir = "/opt/cursor/artifacts/connections-provider-names";
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
  };
}

function row(label, connected, t) {
  const action = connected ? "Disconnect" : "Connect";
  return `
    <div style="display:flex;align-items:center;gap:12px;padding:16px;border-bottom:1px solid ${t.border};">
      <span style="
        width:24px;height:24px;border-radius:999px;border:1px solid ${t.border};
        display:inline-flex;align-items:center;justify-content:center;
        font:600 11px/1 ui-sans-serif,system-ui,sans-serif;
      ">${label.slice(0, 1)}</span>
      <p style="flex:1;margin:0;font:400 14px/20px ui-sans-serif,system-ui,sans-serif;">${label}</p>
      <button type="button" style="
        border:1px solid ${connected ? "#ef4444" : t.border};
        background:${t.card};color:${connected ? "#ef4444" : t.fg};
        border-radius:8px;padding:6px 10px;
        font:500 12px/16px ui-sans-serif,system-ui,sans-serif;
      ">${action}</button>
    </div>
  `;
}

function page(theme, variant) {
  const t = tokens(theme);
  const after = variant === "after";
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
  <section id="shot" style="max-width:640px;margin:0 auto;padding:32px 16px;">
    <div style="border:1px solid ${t.border};border-radius:12px;overflow:hidden;background:${t.card};">
      ${row(after ? "Google is connected" : "is connected", true, t)}
      ${row(after ? "Microsoft is not connected" : "is not connected", false, t)}
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
