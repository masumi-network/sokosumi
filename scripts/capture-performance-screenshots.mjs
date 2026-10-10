import { mkdirSync } from "fs";
import { join } from "path";
import { chromium } from "playwright";

const artifactsDir = "/opt/cursor/artifacts/performance-screenshots";
const repoDir = join(process.cwd(), "docs/images/performance-screenshots");
mkdirSync(artifactsDir, { recursive: true });
mkdirSync(repoDir, { recursive: true });

const X_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`;
const CHEVRON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6l4 4 4-4"/></svg>`;
const MORE = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="13" r="1.5"/></svg>`;
const REFRESH = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>`;

function themeVars(theme) {
  const dark = theme === "dark";
  return {
    dark,
    bg: dark ? "#0a0a0a" : "#ffffff",
    fg: dark ? "#fafafa" : "#0a0a0a",
    muted: dark ? "#a1a1aa" : "#71717a",
    border: dark ? "#27272a" : "#e4e4e7",
    card: dark ? "#0a0a0a" : "#ffffff",
    input: dark ? "#18181b" : "#ffffff",
    popover: dark ? "#18181b" : "#ffffff",
    warning: dark ? "#fbbf24" : "#b45309",
    success: dark ? "#34d399" : "#059669",
    hover: dark ? "#27272a" : "#f4f4f5",
    destructive: dark ? "#f87171" : "#dc2626",
  };
}

function headerBlock(v, status) {
  const statusLine =
    status === "syncing"
      ? `<p>Syncing…</p>`
      : status === "reconnect"
        ? `<p>Not synced yet</p>`
        : `<p>Updated Oct 10, 2026</p>`;
  const warning =
    status === "reconnect"
      ? `<p class="warning">Reconnect this account before syncing statistics. <a href="#">Manage accounts</a></p>`
      : "";

  return `
    <section class="header" data-testid="performance-header">
      <div class="header-row">
        <div class="identity">
          <button class="select" type="button" aria-label="Connected accounts">
            <span class="select-label">${X_ICON}<span>Masumi</span></span>
            ${CHEVRON}
          </button>
          <div class="freshness">${statusLine}</div>
        </div>
        <button class="icon-btn" type="button" aria-label="More actions">${MORE}</button>
      </div>
      ${warning}
    </section>`;
}

function overviewBlock() {
  return `
    <div class="presets">
      <button class="chip" type="button">Last 7 days</button>
      <button class="chip chip-active" type="button">Last 30 days</button>
      <button class="chip" type="button">Last 90 days</button>
    </div>
    <div class="metrics">
      <div><p class="metric-label">Posts</p><p class="metric-value">14</p></div>
      <div><p class="metric-label">Views</p><p class="metric-value">1,373</p></div>
      <div><p class="metric-label">Impressions</p><p class="metric-value">334K</p></div>
      <div><p class="metric-label">Interactions</p><p class="metric-value">918</p></div>
    </div>`;
}

function settingsBlock(v, { menuOpen }) {
  return `
    <section class="settings settings-frame" data-testid="settings-accounts">
      <h1>Social accounts</h1>
      <p class="lede">Connect social accounts to this project. Draft, schedule, and publish posts on any connected platform.</p>
      <ul class="account-list">
        <li class="account-row">
          <span class="provider-badge">${X_ICON}</span>
          <div class="account-copy">
            <p class="handle">@masumi</p>
            <p class="meta"><span>X account</span><span class="status"><span class="dot"></span>Connected</span></p>
          </div>
          <div class="account-actions">
            <button class="icon-btn" type="button" aria-label="Actions for @masumi" data-testid="settings-menu-trigger">${MORE}</button>
            ${
              menuOpen
                ? `<div class="menu" data-testid="settings-menu">
              <button class="menu-item" type="button">${REFRESH}<span>Sync now</span></button>
              <button class="menu-item" type="button">Replace</button>
              <button class="menu-item menu-danger" type="button">Disconnect</button>
            </div>`
                : ""
            }
          </div>
        </li>
      </ul>
    </section>`;
}

function pageCSS(v) {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: Inter, system-ui, -apple-system, sans-serif;
      background: ${v.bg};
      color: ${v.fg};
      padding: 2rem 1rem;
      line-height: 1.5;
    }
    .wrap { max-width: 960px; margin: 0 auto; }
    h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.25rem; }
    .lede { color: ${v.muted}; font-size: 0.875rem; margin-bottom: 1.25rem; }
    .header, .metrics, .account-list {
      border: 1px solid ${v.border};
      border-radius: 0.5rem;
      background: ${v.card};
    }
    .header { padding: 1rem; margin-bottom: 1rem; }
    .header-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem; }
    .identity { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; min-width: 0; }
    .select {
      display: inline-flex; align-items: center; justify-content: space-between; gap: 0.5rem;
      min-width: 200px; height: 2.5rem; padding: 0 0.75rem;
      border: 1px solid ${v.border}; border-radius: 0.375rem; background: ${v.input};
      color: ${v.fg}; font: inherit; font-size: 0.875rem; font-weight: 500;
    }
    .select-label { display: inline-flex; align-items: center; gap: 0.5rem; }
    .freshness { color: ${v.muted}; font-size: 0.875rem; }
    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 2.5rem; height: 2.5rem; border: 1px solid ${v.border}; border-radius: 0.375rem;
      background: ${v.input}; color: ${v.fg};
    }
    .warning { color: ${v.warning}; font-size: 0.875rem; margin-top: 0.75rem; }
    .warning a { color: inherit; }
    .presets { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem; }
    .chip {
      height: 2rem; padding: 0 0.75rem; border: 1px solid ${v.border}; border-radius: 0.375rem;
      background: ${v.input}; color: ${v.fg}; font: inherit; font-size: 0.875rem;
    }
    .chip-active { background: ${v.fg}; color: ${v.bg}; border-color: ${v.fg}; }
    .metrics {
      display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1rem;
      padding: 1.25rem; margin-bottom: 1rem;
    }
    .metric-label { color: ${v.muted}; font-size: 0.875rem; }
    .metric-value { font-size: 1.5rem; font-weight: 600; }
    .settings { max-width: 720px; overflow: visible; }
    .settings-frame { padding-bottom: 9rem; }
    .account-list { list-style: none; }
    .account-row { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; position: relative; }
    .provider-badge {
      display: inline-flex; align-items: center; justify-content: center;
      width: 2.25rem; height: 2.25rem; border: 1px solid ${v.border}; border-radius: 0.375rem;
    }
    .account-copy { min-width: 10rem; flex: 1; }
    .handle { font-size: 0.875rem; font-weight: 500; }
    .meta { color: ${v.muted}; font-size: 0.75rem; display: flex; gap: 0.5rem; align-items: center; }
    .status { display: inline-flex; align-items: center; gap: 0.25rem; }
    .dot { width: 0.375rem; height: 0.375rem; border-radius: 999px; background: ${v.success}; }
    .account-actions { position: relative; margin-left: auto; }
    .menu {
      position: absolute; right: 0; top: calc(100% + 0.25rem); z-index: 10;
      min-width: 11rem; padding: 0.25rem; border: 1px solid ${v.border};
      border-radius: 0.375rem; background: ${v.popover}; box-shadow: 0 8px 24px rgba(0,0,0,0.12);
    }
    .menu-item {
      display: flex; align-items: center; gap: 0.5rem; width: 100%;
      padding: 0.5rem 0.625rem; border: 0; background: transparent; color: ${v.fg};
      font: inherit; font-size: 0.875rem; border-radius: 0.25rem; text-align: left;
    }
    .menu-item:hover { background: ${v.hover}; }
    .menu-danger { color: ${v.destructive}; }
    @media (max-width: 640px) {
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .select { width: 100%; min-width: 0; }
      .identity { width: 100%; }
    }
  `;
}

function html(theme, body) {
  const v = themeVars(theme);
  return `<!DOCTYPE html>
<html lang="en" class="${theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>${pageCSS(v)}</style>
</head>
<body><div class="wrap">${body}</div></body>
</html>`;
}

async function shot(page, name, selector) {
  const target = selector ? page.locator(selector) : page;
  const repoPath = join(repoDir, name);
  const artifactPath = join(artifactsDir, name);
  const opts = selector
    ? { path: repoPath }
    : { path: repoPath, fullPage: true };
  await target.screenshot(opts);
  await target.screenshot(
    selector ? { path: artifactPath } : { path: artifactPath, fullPage: true },
  );
  console.log(`✓ ${name}`);
}

async function render(page, theme, viewport, body) {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme });
  await page.setContent(html(theme, body), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const desktop = { width: 1280, height: 900 };
  const mobile = { width: 375, height: 812 };

  for (const theme of ["light", "dark"]) {
    const v = themeVars(theme);
    await render(
      page,
      theme,
      desktop,
      `<h1>Account performance</h1><p class="lede">View performance metrics and insights for your connected social media accounts</p>${headerBlock(v, "updated")}${overviewBlock()}`,
    );
    await shot(page, `after-${theme}-desktop.png`);
    await shot(
      page,
      `header-updated-${theme}.png`,
      "[data-testid=performance-header]",
    );

    await render(
      page,
      theme,
      desktop,
      `<h1>Account performance</h1>${headerBlock(v, "syncing")}${overviewBlock()}`,
    );
    await shot(
      page,
      `header-syncing-${theme}.png`,
      "[data-testid=performance-header]",
    );

    await render(
      page,
      theme,
      { width: 800, height: 640 },
      settingsBlock(v, { menuOpen: true }),
    );
    await shot(
      page,
      `settings-sync-now-${theme}.png`,
      "[data-testid=settings-accounts]",
    );
  }

  const light = themeVars("light");
  await render(
    page,
    "light",
    mobile,
    `<h1>Account performance</h1>${headerBlock(light, "updated")}${overviewBlock()}`,
  );
  await shot(page, "after-light-mobile.png");

  await render(
    page,
    "dark",
    mobile,
    `<h1>Account performance</h1>${headerBlock(themeVars("dark"), "syncing")}${overviewBlock()}`,
  );
  await shot(page, "after-dark-mobile.png");

  await render(
    page,
    "light",
    desktop,
    `<h1>Account performance</h1>${headerBlock(light, "reconnect")}${overviewBlock()}`,
  );
  await shot(
    page,
    "header-reconnect-light.png",
    "[data-testid=performance-header]",
  );

  await browser.close();
  console.log(`\nSaved to ${repoDir} and ${artifactsDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
