import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { chromium } = require("playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(root, "docs/images/social-accounts");
const artifactsDir = "/opt/cursor/artifacts/social-accounts";
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
    card: dark ? "#1c1c1c" : "#fafafa",
    border: dark ? "#343434" : "#e2e2e2",
    surface: dark ? "#121212" : "#ffffff",
    primary: dark ? "#c4b5fd" : "#4c1d95",
    primaryFg: dark ? "#121212" : "#ffffff",
  };
}

function tab(label, { active = false, count } = {}, t) {
  const bg = active ? t.surface : "transparent";
  const color = active ? t.fg : t.muted;
  const shadow = active ? "0 1px 2px rgb(0 0 0 / 0.06)" : "none";
  const countHtml =
    count == null
      ? ""
      : `<span style="color:${t.muted};font-variant-numeric:tabular-nums">${count}</span>`;
  return `
    <button type="button" style="
      border:0;background:${bg};color:${color};border-radius:6px;
      padding:6px 12px;font:500 14px/20px ui-sans-serif,system-ui,sans-serif;
      box-shadow:${shadow};white-space:nowrap;
    ">${label}${countHtml ? ` ${countHtml}` : ""}</button>
  `;
}

function page(theme, variant) {
  const t = tokens(theme);
  const expired = variant === "after";
  const banner = expired
    ? {
        title: "Reconnect to post",
        body: "Sign in again on a connected account.",
        action: "Reconnect",
      }
    : {
        title: "Connect an account to start posting",
        body: "Posts go out from the X, Instagram, LinkedIn, Facebook and YouTube accounts connected to this project.",
        action: "Connect X, YouTube, LinkedIn…",
      };

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
  <main id="shot" style="max-width:960px;margin:0 auto;padding:32px 16px;display:flex;flex-direction:column;gap:16px;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
      <div style="
        background:${t.card};display:flex;align-items:center;gap:4px;
        border-radius:8px;padding:4px;overflow-x:auto;
      ">
        ${tab("Calendar", { active: true }, t)}
        ${tab("Drafts", {}, t)}
        ${tab("Statistics", {}, t)}
        ${tab("Accounts", { count: expired ? 2 : undefined }, t)}
      </div>
    </div>
    <div style="
      background:${t.card};border:1px solid ${t.border};border-radius:8px;
      padding:16px;display:flex;flex-wrap:wrap;align-items:center;
      justify-content:space-between;gap:12px;
    ">
      <div>
        <p style="margin:0 0 4px;font:500 14px/20px ui-sans-serif,system-ui,sans-serif;">${banner.title}</p>
        <p style="margin:0;max-width:36rem;color:${t.muted};font:400 14px/20px ui-sans-serif,system-ui,sans-serif;">${banner.body}</p>
      </div>
      <button type="button" style="
        border:0;background:${t.fg};color:${t.bg};border-radius:8px;
        padding:8px 12px;font:500 14px/20px ui-sans-serif,system-ui,sans-serif;
        white-space:nowrap;
      ">${banner.action}</button>
    </div>
  </main>
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
      const shot = pageHandle.locator("#shot");
      const buffer = await shot.screenshot();
      writeFileSync(join(docsDir, name), buffer);
      writeFileSync(join(artifactsDir, name), buffer);
      await pageHandle.close();
    }
  }
}
await browser.close();
console.log(`wrote screenshots to ${docsDir} and ${artifactsDir}`);
