import { mkdirSync } from "fs";
import { join } from "path";
import { chromium } from "playwright";

const artifactsDir = "/opt/cursor/artifacts/performance-screenshots";
mkdirSync(artifactsDir, { recursive: true });

const themes = ["light", "dark"];
const viewports = [
  { name: "desktop", width: 1280, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
];

function generateBeforeHTML(theme) {
  const isDark = theme === "dark";
  const bg = isDark ? "#0a0a0a" : "#ffffff";
  const text = isDark ? "#ffffff" : "#000000";
  const border = isDark ? "#27272a" : "#e5e7eb";
  const muted = isDark ? "#a1a1aa" : "#71717a";
  const tabBg = isDark ? "#18181b" : "#f4f4f5";
  const tabActiveBg = isDark ? "#000000" : "#ffffff";

  return `
<!DOCTYPE html>
<html lang="en" class="${theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      background: ${bg};
      color: ${text};
      padding: 2rem 1rem;
      line-height: 1.5;
    }
    .container { max-width: 1200px; margin: 0 auto; }
  </style>
</head>
<body>
  <div class="container">
    <div style="margin-bottom: 1.5rem;">
      <h1 style="font-size: 1.5rem; font-weight: 600; margin-bottom: 0.5rem;">Performance</h1>
      <p style="color: ${muted}; font-size: 0.875rem;">
        View performance metrics and insights for your connected social media accounts
      </p>
    </div>
    
    <!-- Tabs -->
    <div style="background: ${tabBg}; border-radius: 0.5rem; padding: 0.25rem; display: flex; gap: 0.25rem; margin-bottom: 1.5rem; overflow-x: auto;">
      <button style="background: ${tabActiveBg}; border: 1px solid ${border}; border-radius: 0.375rem; padding: 0.5rem 0.75rem; cursor: pointer; font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem; min-width: max-content;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
        <span style="display: flex; flex-direction: column; align-items: start;">
          <span style="font-weight: 500;">Tech Company</span>
          <span style="color: ${muted}; font-size: 0.75rem; font-weight: 400;">X</span>
        </span>
      </button>
      <button style="background: transparent; border: 1px solid transparent; border-radius: 0.375rem; padding: 0.5rem 0.75rem; cursor: pointer; font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem; min-width: max-content;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
        </svg>
        <span style="display: flex; flex-direction: column; align-items: start;">
          <span style="font-weight: 500;">Tech Channel</span>
          <span style="color: ${muted}; font-size: 0.75rem; font-weight: 400;">YouTube</span>
        </span>
      </button>
    </div>
    
    <!-- Account Card -->
    <article style="border: 1px solid ${border}; border-radius: 0.5rem; padding: 1rem; margin-bottom: 1.5rem;">
      <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem; flex-wrap: wrap; gap: 1rem;">
        <div style="min-width: 220px;">
          <h3 style="display: flex; align-items: center; gap: 0.5rem; font-weight: 500; margin-bottom: 0.5rem;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
            <span>Tech Company</span>
          </h3>
          <p style="color: ${muted}; font-size: 0.75rem;">X · @techcompany</p>
          <p style="color: ${muted}; font-size: 0.75rem;">Updated Oct 8, 8:00 AM UTC</p>
        </div>
        <button style="padding: 0.5rem 1rem; background: ${isDark ? "#3b82f6" : "#2563eb"}; color: white; border: none; border-radius: 0.375rem; font-size: 0.875rem; font-weight: 500; cursor: pointer;">
          Sync account
        </button>
      </div>
      
      <!-- Metrics in collapsible -->
      <details open style="margin-bottom: 1rem;">
        <summary style="cursor: pointer; font-weight: 500; margin-bottom: 0.75rem; list-style: none; display: flex; align-items: center; gap: 0.5rem;">
          <svg width="16" height="16" viewBox="0 0 16 16" style="transition: transform 0.2s;">
            <path fill="currentColor" d="M4 6l4 4 4-4"/>
          </svg>
          Account metrics
        </summary>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; padding-left: 1.5rem;">
          <div>
            <p style="color: ${muted}; font-size: 0.875rem;">Followers</p>
            <p style="font-size: 1.125rem; font-weight: 600;">12,500</p>
          </div>
          <div>
            <p style="color: ${muted}; font-size: 0.875rem;">Impressions</p>
            <p style="font-size: 1.125rem; font-weight: 600;">456,789</p>
          </div>
          <div>
            <p style="color: ${muted}; font-size: 0.875rem;">Engagement</p>
            <p style="font-size: 1.125rem; font-weight: 600;">3.2%</p>
          </div>
        </div>
      </details>
      
      <!-- Export/Research actions -->
      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
        <button style="padding: 0.5rem 1rem; background: ${isDark ? "#18181b" : "#f9fafb"}; border: 1px solid ${border}; border-radius: 0.375rem; font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
          </svg>
          Export data
        </button>
        <button style="padding: 0.5rem 1rem; background: ${isDark ? "#18181b" : "#f9fafb"}; border: 1px solid ${border}; border-radius: 0.375rem; font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          Research topics
        </button>
      </div>
    </article>
    
    <!-- Date Range Controls -->
    <div style="display: flex; gap: 0.5rem; margin-bottom: 1.5rem; flex-wrap: wrap;">
      <button style="padding: 0.5rem 1rem; background: ${isDark ? "#18181b" : "#f9fafb"}; border: 1px solid ${border}; border-radius: 0.375rem; font-size: 0.875rem;">
        Last 7 days
      </button>
      <button style="padding: 0.5rem 1rem; background: ${isDark ? "#3b82f6" : "#2563eb"}; color: white; border: none; border-radius: 0.375rem; font-size: 0.875rem; font-weight: 500;">
        Last 30 days
      </button>
      <button style="padding: 0.5rem 1rem; background: ${isDark ? "#18181b" : "#f9fafb"}; border: 1px solid ${border}; border-radius: 0.375rem; font-size: 0.875rem;">
        Last 90 days
      </button>
    </div>
    
    <!-- Overview Section -->
    <div style="border: 1px solid ${border}; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 1.5rem;">
      <h2 style="font-size: 1rem; font-weight: 600; margin-bottom: 1rem;">Overview</h2>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1.5rem;">
        <div>
          <p style="color: ${muted}; font-size: 0.875rem; margin-bottom: 0.25rem;">Total views</p>
          <p style="font-size: 1.875rem; font-weight: 600; line-height: 1;">456,789</p>
          <p style="color: #10b981; font-size: 0.75rem; margin-top: 0.25rem;">+12.5%</p>
        </div>
        <div>
          <p style="color: ${muted}; font-size: 0.875rem; margin-bottom: 0.25rem;">Total interactions</p>
          <p style="font-size: 1.875rem; font-weight: 600; line-height: 1;">8,934</p>
          <p style="color: #10b981; font-size: 0.75rem; margin-top: 0.25rem;">+8.2%</p>
        </div>
        <div>
          <p style="color: ${muted}; font-size: 0.875rem; margin-bottom: 0.25rem;">Engagement rate</p>
          <p style="font-size: 1.875rem; font-weight: 600; line-height: 1;">3.2%</p>
          <p style="color: #ef4444; font-size: 0.75rem; margin-top: 0.25rem;">-1.5%</p>
        </div>
        <div>
          <p style="color: ${muted}; font-size: 0.875rem; margin-bottom: 0.25rem;">Total posts</p>
          <p style="font-size: 1.875rem; font-weight: 600; line-height: 1;">42</p>
        </div>
      </div>
    </div>
    
    <!-- Posts List -->
    <div style="border: 1px solid ${border}; border-radius: 0.5rem; padding: 1.5rem;">
      <h2 style="font-size: 1rem; font-weight: 600; margin-bottom: 1rem;">Top posts</h2>
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <div style="padding: 1rem; border: 1px solid ${border}; border-radius: 0.5rem;">
          <p style="margin-bottom: 0.75rem; line-height: 1.5;">Sample post 1: Here's some interesting content about our latest product updates.</p>
          <div style="display: flex; gap: 1.5rem; color: ${muted}; font-size: 0.875rem; flex-wrap: wrap;">
            <span>18,234 views</span>
            <span>456 likes</span>
            <span>89 comments</span>
          </div>
        </div>
        <div style="padding: 1rem; border: 1px solid ${border}; border-radius: 0.5rem;">
          <p style="margin-bottom: 0.75rem; line-height: 1.5;">Sample post 2: Excited to share our quarterly results!</p>
          <div style="display: flex; gap: 1.5rem; color: ${muted}; font-size: 0.875rem; flex-wrap: wrap;">
            <span>15,678 views</span>
            <span>402 likes</span>
            <span>67 comments</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

async function captureScreenshot(browser, theme, viewport) {
  const page = await browser.newPage();
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme });

  const html = generateBeforeHTML(theme);
  await page.setContent(html);
  await page.waitForTimeout(500);

  const filename = `before-${theme}-${viewport.name}.png`;
  await page.screenshot({
    path: join(artifactsDir, filename),
    fullPage: true,
  });

  console.log(`✓ Captured: ${filename}`);
  await page.close();
}

async function main() {
  const browser = await chromium.launch();

  for (const theme of themes) {
    for (const viewport of viewports) {
      await captureScreenshot(browser, theme, viewport);
    }
  }

  await browser.close();
  console.log("\n✅ All before screenshots captured!");
  console.log(`📁 Saved to: ${artifactsDir}`);
}

main().catch(console.error);
