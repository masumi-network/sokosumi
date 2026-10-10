/**
 * Capture before/after screenshots of Social Scheduling redesign.
 * Run with: node scripts/capture-social-scheduling-screenshots.mjs
 *
 * Prerequisites:
 * - Dev server running on http://localhost:3000
 * - Test account logged in with social connections configured
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const ARTIFACTS_DIR = "/opt/cursor/artifacts";
const DOCS_DIR = join(process.cwd(), "docs/images/social-redesign");

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 375, height: 812 },
};

/**
 * Capture screenshots for a specific scenario
 */
async function captureScenario(page, scenario) {
  const { name, url, viewport, theme, selector, action } = scenario;

  await page.setViewportSize(viewport);

  // Set theme
  await page.emulateMedia({ colorScheme: theme });

  // Navigate
  console.log(`📸 Capturing ${name}...`);
  await page.goto(url, { waitUntil: "networkidle" });

  // Wait for content
  await page.waitForSelector(selector, { timeout: 10000 });

  // Perform action if specified (e.g., open composer)
  if (action) {
    await action(page);
  }

  // Give UI time to settle
  await page.waitForTimeout(500);

  // Capture screenshot
  const filename = `${name}.png`;
  const buffer = await page.screenshot({ fullPage: false });

  // Save to both locations
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  await mkdir(DOCS_DIR, { recursive: true });
  await writeFile(join(ARTIFACTS_DIR, filename), buffer);
  await writeFile(join(DOCS_DIR, filename), buffer);

  console.log(`✅ Saved ${filename}`);
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await browser.newContext({
    baseURL: BASE_URL,
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
  });

  const page = await context.newPage();

  // Login (adjust selector based on your auth setup)
  console.log("🔐 Logging in...");
  await page.goto("/");

  // Wait for auth or navigate directly if already logged in
  try {
    await page.waitForURL("**/projects", { timeout: 5000 });
    console.log("✅ Already logged in");
  } catch {
    console.log(
      "⚠️  Not logged in. Please ensure dev server has test account configured.",
    );
    // You may need to implement actual login flow here
  }

  // Navigate to a project with social connections
  await page.goto("/projects");
  await page.waitForTimeout(1000);

  // Find a project link (adjust selector as needed)
  const projectLink = await page.locator('a[href^="/projects/"]').first();
  if (!(await projectLink.count())) {
    console.error("❌ No projects found. Please create a test project.");
    await browser.close();
    return;
  }

  await projectLink.click();
  await page.waitForURL("**/projects/**");
  const _projectUrl = page.url();

  // Navigate to Social tab
  console.log("📍 Navigating to Social section...");
  await page.click('a[href*="social"], button:has-text("Social")');
  await page.waitForTimeout(1000);
  const socialUrl = page.url();

  const scenarios = [
    // BEFORE: Old composer (for comparison, capture from edit mode since create uses new one)
    {
      name: "before-desktop-dark",
      url: socialUrl,
      viewport: VIEWPORTS.desktop,
      theme: "dark",
      selector: "main",
      action: async (page) => {
        // Try to open old composer via edit on existing post
        const editButton = await page
          .locator('button:has-text("Edit")')
          .first();
        if (await editButton.count()) {
          await editButton.click();
          await page.waitForSelector('[role="dialog"]');
        }
      },
    },
    {
      name: "before-desktop-light",
      url: socialUrl,
      viewport: VIEWPORTS.desktop,
      theme: "light",
      selector: "main",
      action: async (page) => {
        const editButton = await page
          .locator('button:has-text("Edit")')
          .first();
        if (await editButton.count()) {
          await editButton.click();
          await page.waitForSelector('[role="dialog"]');
        }
      },
    },

    // AFTER: New simplified composer
    {
      name: "after-desktop-dark-create",
      url: socialUrl,
      viewport: VIEWPORTS.desktop,
      theme: "dark",
      selector: "main",
      action: async (page) => {
        // Click "New post" button
        await page.click('button:has-text("New post")');
        await page.waitForSelector('[role="dialog"]');
        await page.waitForTimeout(500);
      },
    },
    {
      name: "after-desktop-light-create",
      url: socialUrl,
      viewport: VIEWPORTS.desktop,
      theme: "light",
      selector: "main",
      action: async (page) => {
        await page.click('button:has-text("New post")');
        await page.waitForSelector('[role="dialog"]');
        await page.waitForTimeout(500);
      },
    },

    // Mobile views
    {
      name: "after-mobile-dark-create",
      url: socialUrl,
      viewport: VIEWPORTS.mobile,
      theme: "dark",
      selector: "main",
      action: async (page) => {
        await page.click('button:has-text("New post")');
        await page.waitForSelector('[role="dialog"]');
        await page.waitForTimeout(500);
      },
    },
    {
      name: "after-mobile-light-create",
      url: socialUrl,
      viewport: VIEWPORTS.mobile,
      theme: "light",
      selector: "main",
      action: async (page) => {
        await page.click('button:has-text("New post")');
        await page.waitForSelector('[role="dialog"]');
        await page.waitForTimeout(500);
      },
    },

    // Error state: validation error
    {
      name: "error-desktop-validation",
      url: socialUrl,
      viewport: VIEWPORTS.desktop,
      theme: "dark",
      selector: "main",
      action: async (page) => {
        await page.click('button:has-text("New post")');
        await page.waitForSelector('[role="dialog"]');

        // Deselect all accounts to trigger "select account" error
        const accountButtons = await page.locator(
          '[role="dialog"] button:has(svg)',
        );
        const count = await accountButtons.count();
        for (let i = 0; i < count; i++) {
          const btn = accountButtons.nth(i);
          const text = await btn.textContent();
          if (text?.includes("@") || text?.includes("Account")) {
            await btn.click();
            await page.waitForTimeout(100);
          }
        }

        await page.waitForTimeout(500);
      },
    },

    // Scheduling view
    {
      name: "after-desktop-schedule",
      url: socialUrl,
      viewport: VIEWPORTS.desktop,
      theme: "dark",
      selector: "main",
      action: async (page) => {
        await page.click('button:has-text("New post")');
        await page.waitForSelector('[role="dialog"]');

        // Click "Schedule later" button
        const scheduleBtn = await page.locator(
          'button:has-text("Schedule"), button:has-text("Schedule later")',
        );
        if (await scheduleBtn.count()) {
          await scheduleBtn.click();
          await page.waitForTimeout(500);
        }
      },
    },
  ];

  // Capture all scenarios
  for (const scenario of scenarios) {
    try {
      // Close any open dialogs before next scenario
      const escapes = 3;
      for (let i = 0; i < escapes; i++) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
      }

      await captureScenario(page, scenario);
    } catch (error) {
      console.error(`❌ Failed to capture ${scenario.name}:`, error.message);
    }
  }

  await browser.close();
  console.log("\n✅ All screenshots captured!");
  console.log(`📁 Artifacts: ${ARTIFACTS_DIR}`);
  console.log(`📁 Docs: ${DOCS_DIR}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
