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

function generateHTML(theme, sparse = false) {
  const isDark = theme === "dark";
  const bg = isDark ? "#0a0a0a" : "#ffffff";
  const text = isDark ? "#ffffff" : "#000000";
  const border = isDark ? "#27272a" : "#e5e7eb";
  const muted = isDark ? "#a1a1aa" : "#71717a";
  const buttonBg = isDark ? "#18181b" : "#f9fafb";

  const accountInfo = sparse
    ? {
        name: "Tech Company",
        handle: "@techcompany",
        updated: "Oct 8, 8:00 AM UTC",
      }
    : {
        name: "Tech Company",
        handle: "@techcompany",
        updated: "Oct 8, 8:00 AM UTC",
      };

  const warnings = sparse
    ? `
      <div style="background: ${isDark ? "#422006" : "#fef3c7"}; color: ${isDark ? "#fbbf24" : "#92400e"}; padding: 0.75rem; border-radius: 0.375rem; font-size: 0.875rem; margin-top: 0.75rem;">
        ⚠️ Some metrics unavailable. Platform API limits.
      </div>
      <div style="background: ${isDark ? "#422006" : "#fef3c7"}; color: ${isDark ? "#fbbf24" : "#92400e"}; padding: 0.75rem; border-radius: 0.375rem; font-size: 0.875rem; margin-top: 0.5rem;">
        ⚠️ Limited post history available
      </div>
    `
    : "";

  const metricsContent = sparse
    ? `
      <p style="color: ${muted}; font-size: 0.875rem;">No metrics available. Sync account to fetch data.</p>
    `
    : `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1.5rem;">
        <div>
          <p style="color: ${muted}; font-size: 0.875rem; margin-bottom: 0.25rem;">Total views</p>
          <p style="font-size: 1.875rem; font-weight: 600; line-height: 1;">456,789</p>
          <p style="color: #10b981; font-size: 0.75rem; margin-top: 0.25rem;">+12.5% vs previous period</p>
        </div>
        <div>
          <p style="color: ${muted}; font-size: 0.875rem; margin-bottom: 0.25rem;">Total interactions</p>
          <p style="font-size: 1.875rem; font-weight: 600; line-height: 1;">8,934</p>
          <p style="color: #10b981; font-size: 0.75rem; margin-top: 0.25rem;">+8.2% vs previous period</p>
        </div>
        <div>
          <p style="color: ${muted}; font-size: 0.875rem; margin-bottom: 0.25rem;">Engagement rate</p>
          <p style="font-size: 1.875rem; font-weight: 600; line-height: 1;">3.2%</p>
          <p style="color: #ef4444; font-size: 0.75rem; margin-top: 0.25rem;">-1.5% vs previous period</p>
        </div>
        <div>
          <p style="color: ${muted}; font-size: 0.875rem; margin-bottom: 0.25rem;">Total posts</p>
          <p style="font-size: 1.875rem; font-weight: 600; line-height: 1;">42</p>
        </div>
      </div>
    `;

  const postsContent = sparse
    ? `
      <p style="color: ${muted}; font-size: 0.875rem;">2 posts found (limited by platform API)</p>
    `
    : `
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <div style="padding: 1rem; border: 1px solid ${border}; border-radius: 0.5rem; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='${isDark ? "#18181b" : "#f9fafb"}'" onmouseout="this.style.background='transparent'">
          <p style="margin-bottom: 0.75rem; line-height: 1.5;">Sample post 1: Here's some interesting content about our latest product updates and company announcements.</p>
          <div style="display: flex; gap: 1.5rem; color: ${muted}; font-size: 0.875rem; flex-wrap: wrap;">
            <span>18,234 views</span>
            <span>456 likes</span>
            <span>89 comments</span>
            <span>23 shares</span>
            <span style="color: #10b981;">4.2% engagement</span>
          </div>
        </div>
        <div style="padding: 1rem; border: 1px solid ${border}; border-radius: 0.5rem; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='${isDark ? "#18181b" : "#f9fafb"}'" onmouseout="this.style.background='transparent'">
          <p style="margin-bottom: 0.75rem; line-height: 1.5;">Sample post 2: Excited to share our quarterly results and upcoming roadmap with the community!</p>
          <div style="display: flex; gap: 1.5rem; color: ${muted}; font-size: 0.875rem; flex-wrap: wrap;">
            <span>15,678 views</span>
            <span>402 likes</span>
            <span>67 comments</span>
            <span>18 shares</span>
            <span style="color: #10b981;">3.8% engagement</span>
          </div>
        </div>
        <div style="padding: 1rem; border: 1px solid ${border}; border-radius: 0.5rem; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='${isDark ? "#18181b" : "#f9fafb"}'" onmouseout="this.style.background='transparent'">
          <p style="margin-bottom: 0.75rem; line-height: 1.5;">Sample post 3: Behind the scenes look at our new feature development process.</p>
          <div style="display: flex; gap: 1.5rem; color: ${muted}; font-size: 0.875rem; flex-wrap: wrap;">
            <span>12,456 views</span>
            <span>334 likes</span>
            <span>45 comments</span>
            <span>12 shares</span>
            <span style="color: #10b981;">3.1% engagement</span>
          </div>
        </div>
      </div>
    `;

  return `
<!DOCTYPE html>
<html lang="en" class="${theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
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
    button { cursor: pointer; font-family: inherit; }
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
    
    <!-- Unified Header -->
    <section style="border: 1px solid ${border}; border-radius: 0.5rem; padding: 1rem; margin-bottom: 1.5rem;">
      <div style="display: flex; justify-content: space-between; align-items: start; gap: 1rem; flex-wrap: wrap;">
        <div style="flex: 1; min-width: 220px;">
          <!-- Account selector button -->
          <button style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem; background: ${buttonBg}; border: 1px solid ${border}; border-radius: 0.375rem; font-size: 0.875rem; margin-bottom: 0.75rem; width: 100%; max-width: 300px;">
            <span style="flex: 1; text-align: left; font-weight: 500;">${accountInfo.name}</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 6l4 4 4-4"/>
            </svg>
          </button>
          <div style="color: ${muted}; font-size: 0.875rem; line-height: 1.4;">
            <p>${accountInfo.handle}</p>
            <p style="margin-top: 0.125rem;">Updated ${accountInfo.updated}</p>
          </div>
        </div>
        <div style="display: flex; gap: 0.5rem; align-items: start;">
          <button style="padding: 0.5rem 1rem; background: ${isDark ? "#3b82f6" : "#2563eb"}; color: white; border: none; border-radius: 0.375rem; font-size: 0.875rem; font-weight: 500;">
            Sync account
          </button>
          <button style="padding: 0.5rem 0.75rem; background: ${buttonBg}; border: 1px solid ${border}; border-radius: 0.375rem; font-size: 0.875rem;">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="8" cy="3" r="1.5"/>
              <circle cx="8" cy="8" r="1.5"/>
              <circle cx="8" cy="13" r="1.5"/>
            </svg>
          </button>
        </div>
      </div>
      ${warnings}
    </section>
    
    <!-- Date Range Controls -->
    <div style="display: flex; gap: 0.5rem; margin-bottom: 1.5rem; flex-wrap: wrap;">
      <button style="padding: 0.5rem 1rem; background: ${buttonBg}; border: 1px solid ${border}; border-radius: 0.375rem; font-size: 0.875rem;">
        Last 7 days
      </button>
      <button style="padding: 0.5rem 1rem; background: ${isDark ? "#3b82f6" : "#2563eb"}; color: white; border: none; border-radius: 0.375rem; font-size: 0.875rem; font-weight: 500;">
        Last 30 days
      </button>
      <button style="padding: 0.5rem 1rem; background: ${buttonBg}; border: 1px solid ${border}; border-radius: 0.375rem; font-size: 0.875rem;">
        Last 90 days
      </button>
    </div>
    
    <!-- Metrics Overview -->
    <div style="border: 1px solid ${border}; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 1.5rem;">
      <h2 style="font-size: 1rem; font-weight: 600; margin-bottom: 1rem;">Overview</h2>
      ${metricsContent}
    </div>
    
    <!-- Posts List -->
    <div style="border: 1px solid ${border}; border-radius: 0.5rem; padding: 1.5rem;">
      <h2 style="font-size: 1rem; font-weight: 600; margin-bottom: 1rem;">Top posts</h2>
      ${postsContent}
    </div>
  </div>
</body>
</html>
  `;
}

async function captureScreenshot(browser, theme, viewport, sparse = false) {
  const page = await browser.newPage();
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme });

  const html = generateHTML(theme, sparse);
  await page.setContent(html);
  await page.waitForTimeout(500);

  const suffix = sparse ? "-sparse" : "";
  const filename = `after-${theme}-${viewport.name}${suffix}.png`;
  await page.screenshot({
    path: join(artifactsDir, filename),
    fullPage: true,
  });

  console.log(`✓ Captured: ${filename}`);
  await page.close();
}

async function main() {
  const browser = await chromium.launch();

  // Capture all combinations
  for (const theme of themes) {
    for (const viewport of viewports) {
      await captureScreenshot(browser, theme, viewport, false);
    }
  }

  // Capture sparse data case (light desktop only)
  await captureScreenshot(browser, "light", viewports[0], true);

  await browser.close();
  console.log("\n✅ All screenshots captured successfully!");
  console.log(`📁 Saved to: ${artifactsDir}`);
}

main().catch(console.error);
