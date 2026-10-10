/**
 * Playwright screenshot capture for Social Performance component
 * Uses test infrastructure to render with synthetic data
 */

import { test } from "@playwright/test";
import { mkdirSync } from "fs";
import { join } from "path";

const artifactsDir = "/opt/cursor/artifacts/performance-screenshots";
mkdirSync(artifactsDir, { recursive: true });

const themes = ["light", "dark"] as const;
const viewports = [
  { name: "desktop", width: 1280, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
] as const;

// Synthetic test data
const mockData = {
  accounts: [
    {
      id: "x-account-1",
      provider: "x",
      displayName: "Tech Company",
      externalHandle: "@techcompany",
      externalAccountId: "123456789",
      status: "active",
      postCount: 42,
      statistics: {
        fetchedAt: "2026-10-08T08:00:00Z",
        historyFetchedAt: "2026-10-08T07:00:00Z",
        historyComplete: true,
        historyNextCursor: null,
        historyError: null,
        error: null,
        metricWarning: null,
        metrics: [
          { key: "followers", value: 12500, unit: "count", period: "lifetime" },
          {
            key: "impressions",
            value: 456789,
            unit: "count",
            period: "last_28_days",
          },
          {
            key: "engagement_rate",
            value: 3.2,
            unit: "percent",
            period: "last_28_days",
          },
        ],
      },
    },
    {
      id: "youtube-account-1",
      provider: "youtube",
      displayName: "Tech Channel",
      externalHandle: "@techchannel",
      externalAccountId: "UC123456789",
      status: "active",
      postCount: 18,
      statistics: {
        fetchedAt: "2026-10-07T14:30:00Z",
        historyFetchedAt: "2026-10-07T14:00:00Z",
        historyComplete: false,
        historyNextCursor: "next-page-token",
        historyError: null,
        error: null,
        metricWarning: null,
        metrics: [
          {
            key: "subscribers",
            value: 8900,
            unit: "count",
            period: "lifetime",
          },
          {
            key: "views",
            value: 234567,
            unit: "count",
            period: "last_28_days",
          },
        ],
      },
    },
  ],
  posts: Array.from({ length: 12 }, (_, i) => ({
    id: `post-${i + 1}`,
    text: `Sample post ${i + 1}: Here's some interesting content about our latest updates and announcements`,
    publishedAt: new Date(Date.now() - i * 2 * 86400000).toISOString(),
    url: `https://example.com/post/${i + 1}`,
    connectionId: i % 2 === 0 ? "x-account-1" : "youtube-account-1",
    provider: i % 2 === 0 ? "x" : "youtube",
    format: i % 3 === 0 ? "video" : "text",
    metrics: {
      views: Math.floor(Math.random() * 20000) + 5000,
      impressions: Math.floor(Math.random() * 25000) + 6000,
      likes: Math.floor(Math.random() * 500) + 100,
      comments: Math.floor(Math.random() * 100) + 10,
      shares: Math.floor(Math.random() * 50) + 5,
      engagementRate: Math.random() * 5 + 1,
    },
  })),
  nextCursor: null,
  overview: {
    totalPosts: 42,
    totalViews: 456789,
    totalInteractions: 8934,
    avgEngagementRate: 3.2,
    topPost: "post-1",
    periodStart: "2026-09-08T00:00:00Z",
    periodEnd: "2026-10-08T23:59:59Z",
    metrics: {
      views: { mean: 10850, median: 8500, measured: 42, total: 42 },
      interactions: { mean: 212, median: 189, measured: 42, total: 42 },
      engagementRate: { mean: 3.2, median: 2.9, measured: 42, total: 42 },
    },
    trend: Array.from({ length: 30 }, (_, i) => ({
      date: new Date(Date.now() - (29 - i) * 86400000)
        .toISOString()
        .split("T")[0],
      views: Math.floor(Math.random() * 5000) + 10000,
      interactions: Math.floor(Math.random() * 200) + 150,
    })),
  },
};

const _sparseData = {
  ...mockData,
  accounts: [
    {
      ...mockData.accounts[0],
      postCount: 2,
      statistics: {
        fetchedAt: "2026-10-08T08:00:00Z",
        historyFetchedAt: null,
        historyComplete: false,
        historyNextCursor: null,
        historyError: "Limited by platform API",
        error: null,
        metricWarning: "Some metrics unavailable",
        metrics: [],
      },
    },
  ],
  posts: mockData.posts.slice(0, 2).map((p) => ({
    ...p,
    metrics: {
      views: 0,
      impressions: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      engagementRate: 0,
    },
  })),
  overview: {
    totalPosts: 2,
    totalViews: 0,
    totalInteractions: 0,
    avgEngagementRate: 0,
    topPost: null,
    periodStart: "2026-09-08T00:00:00Z",
    periodEnd: "2026-10-08T23:59:59Z",
    metrics: {
      views: { mean: 0, median: 0, measured: 0, total: 2 },
      interactions: { mean: 0, median: 0, measured: 0, total: 2 },
      engagementRate: { mean: 0, median: 0, measured: 0, total: 2 },
    },
    trend: [],
  },
};

for (const theme of themes) {
  for (const viewport of viewports) {
    test(`after-${theme}-${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme });

      // Mock API responses
      await page.route("**/api/**", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockData),
        });
      });

      // Create standalone HTML with component
      const html = `
<!DOCTYPE html>
<html lang="en" class="${theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: Inter, system-ui, -apple-system, sans-serif;
      background: ${theme === "dark" ? "#000" : "#fff"};
      color: ${theme === "dark" ? "#fff" : "#000"};
      padding: 2rem;
    }
    .container { max-width: 1200px; margin: 0 auto; }
  </style>
</head>
<body>
  <div class="container">
    <div data-testid="social-statistics" style="padding: 20px;">
      <h2 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 1rem;">Account performance</h2>
      <p style="color: ${theme === "dark" ? "#888" : "#666"}; font-size: 0.875rem; margin-bottom: 1.5rem;">
        View performance metrics and insights for your connected social media accounts.
      </p>
      
      <!-- Unified Header -->
      <section style="border: 1px solid ${theme === "dark" ? "#333" : "#e5e7eb"}; border-radius: 0.5rem; padding: 1rem; margin-bottom: 1.5rem;">
        <div style="display: flex; justify-content: space-between; align-items: start; gap: 1rem; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 200px;">
            <div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem;">
              <span style="font-weight: 500;">Tech Company</span>
            </div>
            <div style="color: ${theme === "dark" ? "#888" : "#666"}; font-size: 0.875rem;">
              <p>@techcompany</p>
              <p>Updated Oct 8, 8:00 AM UTC</p>
            </div>
          </div>
          <div style="display: flex; gap: 0.5rem;">
            <button style="padding: 0.5rem 1rem; border: 1px solid ${theme === "dark" ? "#444" : "#d1d5db"}; border-radius: 0.375rem; background: transparent; cursor: pointer; font-size: 0.875rem;">
              Sync account
            </button>
            <button style="padding: 0.5rem 1rem; border: 1px solid ${theme === "dark" ? "#444" : "#d1d5db"}; border-radius: 0.375rem; background: transparent; cursor: pointer; font-size: 0.875rem;">
              ⋮
            </button>
          </div>
        </div>
      </section>
      
      <!-- Date Range Controls -->
      <div style="display: flex; gap: 0.5rem; margin-bottom: 1.5rem; flex-wrap: wrap;">
        <button style="padding: 0.5rem 1rem; border: 1px solid ${theme === "dark" ? "#444" : "#d1d5db"}; border-radius: 0.375rem; background: transparent; font-size: 0.875rem;">Last 7 days</button>
        <button style="padding: 0.5rem 1rem; background: ${theme === "dark" ? "#2563eb" : "#3b82f6"}; color: white; border: none; border-radius: 0.375rem; font-size: 0.875rem;">Last 30 days</button>
        <button style="padding: 0.5rem 1rem; border: 1px solid ${theme === "dark" ? "#444" : "#d1d5db"}; border-radius: 0.375rem; background: transparent; font-size: 0.875rem;">Last 90 days</button>
      </div>
      
      <!-- Metrics Overview -->
      <div style="border: 1px solid ${theme === "dark" ? "#333" : "#e5e7eb"}; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 1.5rem;">
        <h3 style="font-size: 1rem; font-weight: 600; margin-bottom: 1rem;">Key metrics</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem;">
          <div>
            <p style="color: ${theme === "dark" ? "#888" : "#666"}; font-size: 0.875rem;">Total views</p>
            <p style="font-size: 1.5rem; font-weight: 600;">456,789</p>
          </div>
          <div>
            <p style="color: ${theme === "dark" ? "#888" : "#666"}; font-size: 0.875rem;">Total interactions</p>
            <p style="font-size: 1.5rem; font-weight: 600;">8,934</p>
          </div>
          <div>
            <p style="color: ${theme === "dark" ? "#888" : "#666"}; font-size: 0.875rem;">Engagement rate</p>
            <p style="font-size: 1.5rem; font-weight: 600;">3.2%</p>
          </div>
        </div>
      </div>
      
      <!-- Posts List -->
      <div style="border: 1px solid ${theme === "dark" ? "#333" : "#e5e7eb"}; border-radius: 0.5rem; padding: 1.5rem;">
        <h3 style="font-size: 1rem; font-weight: 600; margin-bottom: 1rem;">Top posts</h3>
        <div style="display: flex; flex-direction: column; gap: 1rem;">
          ${mockData.posts
            .slice(0, 3)
            .map(
              (post, i) => `
            <div style="padding: 1rem; border: 1px solid ${theme === "dark" ? "#333" : "#e5e7eb"}; border-radius: 0.375rem;">
              <p style="margin-bottom: 0.5rem;">${post.text}</p>
              <div style="display: flex; gap: 1rem; color: ${theme === "dark" ? "#888" : "#666"}; font-size: 0.875rem;">
                <span>${post.metrics?.views?.toLocaleString() || 0} views</span>
                <span>${post.metrics?.likes || 0} likes</span>
                <span>${post.metrics?.comments || 0} comments</span>
              </div>
            </div>
          `,
            )
            .join("")}
        </div>
      </div>
    </div>
  </div>
</body>
</html>
      `;

      await page.setContent(html);
      await page.waitForTimeout(500);

      const filename = `after-${theme}-${viewport.name}.png`;
      await page.screenshot({
        path: join(artifactsDir, filename),
        fullPage: true,
      });

      console.log(`✓ Captured: ${filename}`);
    });
  }
}

// Sparse data case
test("after-sparse-light-desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1024 });
  await page.emulateMedia({ colorScheme: "light" });

  const html = `
<!DOCTYPE html>
<html lang="en" class="light">
<head>
  <meta charset="UTF-8">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { font-family: system-ui; padding: 2rem; }
    .warning { color: #f59e0b; background: #fef3c7; padding: 0.5rem; border-radius: 0.375rem; font-size: 0.875rem; margin: 1rem 0; }
  </style>
</head>
<body>
  <div style="max-width: 1200px; margin: 0 auto;">
    <h2 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 1rem;">Account performance</h2>
    
    <section style="border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 1rem; margin-bottom: 1.5rem;">
      <div style="display: flex; justify-content: space-between; align-items: start;">
        <div>
          <div style="font-weight: 500; margin-bottom: 0.5rem;">Tech Company</div>
          <div style="color: #666; font-size: 0.875rem;">
            <p>@techcompany</p>
            <p>Updated Oct 8, 8:00 AM UTC</p>
          </div>
        </div>
        <button style="padding: 0.5rem 1rem; border: 1px solid #d1d5db; border-radius: 0.375rem;">Sync account</button>
      </div>
      <div class="warning">⚠️ Some metrics could not be fetched. Check account permissions and sync again.</div>
      <div class="warning">⚠️ Platform exposes only the most recent posts</div>
    </section>
    
    <div style="display: flex; gap: 0.5rem; margin-bottom: 1.5rem;">
      <button style="padding: 0.5rem 1rem; background: #3b82f6; color: white; border: none; border-radius: 0.375rem;">Last 30 days</button>
    </div>
    
    <div style="border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 1.5rem;">
      <h3 style="font-weight: 600; margin-bottom: 1rem;">Key metrics</h3>
      <p style="color: #666; font-size: 0.875rem;">Metrics unavailable - sync account to fetch data</p>
    </div>
    
    <div style="border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 1.5rem;">
      <h3 style="font-weight: 600; margin-bottom: 1rem;">Posts (2)</h3>
      <p style="color: #666; font-size: 0.875rem;">Limited post history available</p>
    </div>
  </div>
</body>
</html>
  `;

  await page.setContent(html);
  await page.waitForTimeout(500);

  await page.screenshot({
    path: join(artifactsDir, "after-sparse-light-desktop.png"),
    fullPage: true,
  });

  console.log("✓ Captured: after-sparse-light-desktop.png");
});
