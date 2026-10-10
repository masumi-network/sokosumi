import { mkdirSync } from "fs";
import { join } from "path";
import { chromium } from "playwright";

const artifactsDir = "/opt/cursor/artifacts/social-screenshots";
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
  const buttonBg = isDark ? "#18181b" : "#f9fafb";
  const primary = isDark ? "#3b82f6" : "#2563eb";

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
      background: ${isDark ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.5)"};
      color: ${text};
      padding: 2rem 1rem;
      line-height: 1.5;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .modal { 
      background: ${bg};
      border: 1px solid ${border};
      border-radius: 0.75rem;
      max-width: 900px;
      width: 100%;
      box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04);
    }
    button { cursor: pointer; font-family: inherit; }
  </style>
</head>
<body>
  <div class="modal">
    <!-- Header -->
    <div style="border-bottom: 1px solid ${border}; padding: 1.5rem;">
      <h2 style="font-size: 1.125rem; font-weight: 600;">New post</h2>
    </div>

    <!-- Content - Split layout for desktop -->
    <div style="display: grid; grid-template-columns: 1fr 384px; min-height: 500px;">
      <!-- Editor panel -->
      <div style="display: flex; flex-direction: column;">
        <!-- Account selection -->
        <div style="padding: 1rem 2rem; border-bottom: 1px solid ${border};">
          <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;">
            <span style="color: ${muted}; font-size: 0.875rem; font-weight: 500;">Accounts</span>
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
            <button style="display: inline-flex; align-items: center; gap: 0.5rem; height: 2rem; padding: 0 0.75rem 0 0.25rem; border: 1px solid ${text}; border-radius: 9999px; background: transparent; font-size: 0.875rem; font-weight: 500;">
              <span style="display: flex; align-items: center; justify-content: center; width: 1.5rem; height: 1.5rem; background: ${buttonBg}; border-radius: 9999px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
              </span>
              <span>@techcompany</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 12l5 5L20 7"/>
              </svg>
            </button>
            <button style="display: inline-flex; align-items: center; gap: 0.5rem; height: 2rem; padding: 0 0.75rem 0 0.25rem; border: 1px solid ${border}; border-radius: 9999px; background: transparent; font-size: 0.875rem; color: ${muted};">
              <span style="display: flex; align-items: center; justify-content: center; width: 1.5rem; height: 1.5rem; background: ${buttonBg}; border-radius: 9999px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.32 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.79M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z"/>
                </svg>
              </span>
              <span>@techcompany</span>
            </button>
          </div>
        </div>

        <!-- Text editor -->
        <div style="padding: 1.5rem 2rem; border-bottom: 1px solid ${border}; flex: 1;">
          <textarea style="width: 100%; min-height: 160px; resize: none; border: none; background: transparent; font-size: 1rem; line-height: 1.75; outline: none; color: ${text};" placeholder="What's happening?"></textarea>
          
          <!-- Media controls -->
          <div style="display: flex; align-items: center; gap: 0.25rem; margin-top: 1rem;">
            <button style="display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem; border: none; background: transparent; color: ${muted}; font-size: 0.875rem; border-radius: 0.375rem;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <path d="M21 15l-5-5L5 21"/>
              </svg>
              Add from Drive
            </button>
            <button style="display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem; border: none; background: transparent; color: ${muted}; font-size: 0.875rem; border-radius: 0.375rem;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              Upload
            </button>
            <span style="margin-left: auto; font-size: 0.75rem; color: ${muted}; tabular-nums;">0 / 280</span>
          </div>
        </div>

        <!-- Schedule section -->
        <div style="padding: 1.5rem 2rem; border-bottom: 1px solid ${border};">
          <h3 style="font-size: 0.875rem; font-weight: 600; margin-bottom: 0.25rem;">When</h3>
          <p style="color: ${muted}; font-size: 0.75rem; margin-bottom: 1rem;">If blank, the post will be saved as a draft</p>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.5rem;">
            <div>
              <label style="display: block; font-size: 0.75rem; font-weight: 500; color: ${muted}; margin-bottom: 0.25rem;">Date</label>
              <input type="date" style="width: 100%; padding: 0.5rem 0.75rem; border: 1px solid ${border}; border-radius: 0.375rem; background: ${bg}; color: ${text}; font-size: 0.875rem;" />
            </div>
            <div>
              <label style="display: block; font-size: 0.75rem; font-weight: 500; color: ${muted}; margin-bottom: 0.25rem;">Time</label>
              <input type="time" style="width: 100%; padding: 0.5rem 0.75rem; border: 1px solid ${border}; border-radius: 0.375rem; background: ${bg}; color: ${text}; font-size: 0.875rem;" />
            </div>
            <div>
              <label style="display: block; font-size: 0.75rem; font-weight: 500; color: ${muted}; margin-bottom: 0.25rem;">Timezone</label>
              <select style="width: 100%; padding: 0.5rem 0.75rem; border: 1px solid ${border}; border-radius: 0.375rem; background: ${bg}; color: ${text}; font-size: 0.875rem;">
                <option>America/New York</option>
              </select>
            </div>
          </div>

          <p style="color: ${muted}; font-size: 0.75rem; margin-top: 0.75rem;">Your timezone: America/New York</p>
        </div>
      </div>

      <!-- Preview panel -->
      <div style="background: ${isDark ? "#171717" : "#fafafa"}; border-left: 1px solid ${border}; padding: 1.5rem;">
        <p style="color: ${muted}; font-size: 0.75rem; font-weight: 500; margin-bottom: 0.75rem;">Preview</p>
        
        <!-- Mock post preview -->
        <div style="border: 1px solid ${border}; border-radius: 0.5rem; padding: 1rem; background: ${bg};">
          <div style="display: flex; gap: 0.75rem; margin-bottom: 0.75rem;">
            <div style="width: 2.5rem; height: 2.5rem; border-radius: 9999px; background: ${buttonBg}; flex-shrink: 0;"></div>
            <div style="flex: 1;">
              <div style="font-weight: 600; font-size: 0.9375rem;">Tech Company</div>
              <div style="color: ${muted}; font-size: 0.875rem;">@techcompany</div>
            </div>
          </div>
          <p style="color: ${muted}; font-size: 0.9375rem; line-height: 1.5;">Your post will appear here...</p>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 2rem; border-top: 1px solid ${border};">
      <span style="color: ${muted}; font-size: 0.875rem;">Post will be saved as a draft</span>
      <div style="display: flex; gap: 0.5rem;">
        <button style="padding: 0.5rem 1rem; border: 1px solid ${border}; background: transparent; color: ${muted}; border-radius: 0.375rem; font-size: 0.875rem; font-weight: 500;">Save draft</button>
        <button style="padding: 0.5rem 1rem; border: none; background: ${primary}; color: white; border-radius: 0.375rem; font-size: 0.875rem; font-weight: 500; opacity: 0.5;">Schedule</button>
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

function generateAfterHTML(theme) {
  const isDark = theme === "dark";
  const bg = isDark ? "#0a0a0a" : "#ffffff";
  const text = isDark ? "#ffffff" : "#000000";
  const border = isDark ? "#27272a" : "#e5e7eb";
  const muted = isDark ? "#a1a1aa" : "#71717a";
  const _buttonBg = isDark ? "#18181b" : "#f9fafb";
  const primary = isDark ? "#3b82f6" : "#2563eb";

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
      background: ${isDark ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.5)"};
      color: ${text};
      padding: 2rem 1rem;
      line-height: 1.5;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .modal { 
      background: ${bg};
      border: 1px solid ${border};
      border-radius: 0.75rem;
      max-width: 600px;
      width: 100%;
      box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04);
    }
    button { cursor: pointer; font-family: inherit; }
  </style>
</head>
<body>
  <div class="modal">
    <!-- Header -->
    <div style="border-bottom: 1px solid ${border}; padding: 1.5rem;">
      <h2 style="font-size: 1.125rem; font-weight: 600;">New post</h2>
      <p style="color: ${muted}; font-size: 0.875rem; margin-top: 0.25rem;">All active accounts selected. Type and post.</p>
    </div>

    <!-- Content -->
    <div style="padding: 1.5rem; space-y: 1rem;">
      <!-- Text editor -->
      <div>
        <textarea style="width: 100%; min-height: 120px; resize: none; border: 1px solid ${border}; background: ${bg}; font-size: 1rem; line-height: 1.5; outline: none; color: ${text}; padding: 0.75rem; border-radius: 0.5rem;" placeholder="What's happening?" autofocus></textarea>
        
        <!-- Character counts (shown when typing) -->
        <div style="display: flex; gap: 0.75rem; margin-top: 0.5rem; font-size: 0.75rem; color: ${muted};">
          <span>X: 0/280</span>
          <span>LinkedIn: 0/3000</span>
        </div>
      </div>

      <!-- Account selection -->
      <div>
        <p style="font-size: 0.875rem; font-weight: 500; margin-bottom: 0.5rem;">Post to</p>
        <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
          <button style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem; border: 1px solid ${primary}; background: ${isDark ? "rgba(59,130,246,0.1)" : "rgba(37,99,235,0.1)"}; border-radius: 0.5rem; transition: all 0.2s;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
            <span style="font-size: 0.875rem;">@techcompany</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12l5 5L20 7"/>
            </svg>
          </button>
          <button style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem; border: 1px solid ${primary}; background: ${isDark ? "rgba(59,130,246,0.1)" : "rgba(37,99,235,0.1)"}; border-radius: 0.5rem; transition: all 0.2s;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.32 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.79M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z"/>
            </svg>
            <span style="font-size: 0.875rem;">@techcompany</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12l5 5L20 7"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Schedule mode -->
      <div>
        <p style="font-size: 0.875rem; font-weight: 500; margin-bottom: 0.5rem;">When</p>
        <div style="display: flex; gap: 0.5rem;">
          <button style="padding: 0.5rem 1rem; border: none; background: ${primary}; color: white; border-radius: 0.375rem; font-size: 0.875rem; font-weight: 500;">Post now</button>
          <button style="padding: 0.5rem 1rem; border: 1px solid ${border}; background: ${bg}; color: ${text}; border-radius: 0.375rem; font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem; opacity: 0.5;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            Schedule later
          </button>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div style="display: flex; align-items: center; justify-content: end; gap: 0.5rem; padding: 1rem 1.5rem; border-top: 1px solid ${border};">
      <button style="padding: 0.5rem 1rem; border: 1px solid ${border}; background: transparent; color: ${muted}; border-radius: 0.375rem; font-size: 0.875rem; font-weight: 500; opacity: 0.5;">Save draft</button>
      <button style="padding: 0.5rem 1rem; border: none; background: ${primary}; color: white; border-radius: 0.375rem; font-size: 0.875rem; font-weight: 500; opacity: 0.5;">Post</button>
    </div>
  </div>
</body>
</html>
  `;
}

async function captureScreenshot(browser, theme, viewport, type) {
  const page = await browser.newPage();
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme });

  const html =
    type === "before" ? generateBeforeHTML(theme) : generateAfterHTML(theme);
  await page.setContent(html);
  await page.waitForTimeout(500);

  const filename = `${type}-${theme}-${viewport.name}.png`;
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
      await captureScreenshot(browser, theme, viewport, "before");
      await captureScreenshot(browser, theme, viewport, "after");
    }
  }

  await browser.close();
  console.log("\n✅ All screenshots captured successfully!");
  console.log(`📁 Saved to: ${artifactsDir}`);
}

main().catch(console.error);
