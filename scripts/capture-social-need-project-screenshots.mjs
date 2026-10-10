import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { chromium } = require("playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(root, "docs/images/social-need-project");
const artifactsDir = "/opt/cursor/artifacts/social-need-project";
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
    card: dark ? "#1c1c1c" : "#fafafa",
  };
}

function page(theme, variant) {
  const t = tokens(theme);
  const after = variant === "after";
  const title = after ? "Choose a project" : "Connect your social accounts";
  const body = after
    ? "Then connect accounts."
    : "Bring your channels together. Choose a project to connect accounts, then draft, schedule, and publish your posts.";

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
  <section id="shot" style="max-width:720px;margin:0 auto;padding:48px 16px;text-align:center;">
    <div style="display:flex;justify-content:center;gap:8px;margin-bottom:24px;">
      ${["X", "IG", "In", "Fb", "YT"]
        .map(
          (label) => `
        <div style="
          width:72px;height:88px;border:1px solid ${t.border};border-radius:16px;
          background:${t.card};display:flex;align-items:center;justify-content:center;
          font:600 14px/1 ui-sans-serif,system-ui,sans-serif;
        ">${label}</div>`,
        )
        .join("")}
    </div>
    <h2 style="margin:0;font:300 24px/32px ui-sans-serif,system-ui,sans-serif;">${title}</h2>
    <p style="margin:12px auto 0;max-width:28rem;color:${t.muted};font:400 14px/20px ui-sans-serif,system-ui,sans-serif;">
      ${body}
    </p>
    <button type="button" style="
      margin-top:24px;border:0;background:${t.fg};color:${t.bg};border-radius:8px;
      padding:8px 14px;font:500 14px/20px ui-sans-serif,system-ui,sans-serif;
    ">Choose a project</button>
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
