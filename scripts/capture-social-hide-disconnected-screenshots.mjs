import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { chromium } = require("playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(root, "docs/images/social-hide-disconnected");
const artifactsDir = "/opt/cursor/artifacts/social-hide-disconnected";
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
    success: dark ? "#4ade80" : "#16a34a",
  };
}

function accountRow({ handle, status, statusColor, showMenu }, t) {
  return `
    <li style="display:flex;align-items:center;gap:12px;padding:12px;border-top:1px solid ${t.border};">
      <span style="
        width:36px;height:36px;border-radius:8px;border:1px solid ${t.border};
        display:inline-flex;align-items:center;justify-content:center;
        font:600 14px/1 ui-sans-serif,system-ui,sans-serif;
      ">X</span>
      <div style="flex:1;min-width:0;">
        <p style="margin:0;font:500 14px/20px ui-sans-serif,system-ui,sans-serif;">${handle}</p>
        <p style="margin:0;color:${t.muted};font:400 12px/16px ui-sans-serif,system-ui,sans-serif;">
          X account · <span style="color:${statusColor}">${status}</span>
        </p>
      </div>
      ${
        showMenu
          ? `<span style="color:${t.muted};font:700 16px/1 ui-sans-serif,system-ui,sans-serif;">···</span>`
          : ""
      }
    </li>
  `;
}

function page(theme, variant) {
  const t = tokens(theme);
  const after = variant === "after";
  const dead = after
    ? ""
    : accountRow(
        {
          handle: "@old-account",
          status: "Disconnected",
          statusColor: t.muted,
          showMenu: false,
        },
        t,
      );

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
    <h2 style="margin:0 0 12px;font:600 16px/24px ui-sans-serif,system-ui,sans-serif;">Social accounts</h2>
    <ul style="margin:0;padding:0;list-style:none;border:1px solid ${t.border};border-radius:8px;overflow:hidden;">
      ${accountRow(
        {
          handle: "@sokosumi",
          status: "Connected",
          statusColor: t.success,
          showMenu: true,
        },
        t,
      )}
      ${dead}
    </ul>
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
