import { describe, expect, it } from "vitest";

import {
  DEVELOPER_TAB_REDIRECTS,
  getDeveloperNavItems,
} from "./developer-menu-config";

describe("getDeveloperNavItems", () => {
  it("hides vendors by default", () => {
    const items = getDeveloperNavItems({ showVendors: false });

    expect(items.map((item) => item.key)).toEqual([
      "docs",
      "oauthClients",
      "apiKeys",
      "coworkers",
      "tasks",
    ]);
  });

  it("inserts vendors after api keys when enabled", () => {
    const items = getDeveloperNavItems({ showVendors: true });

    expect(items.map((item) => item.key)).toEqual([
      "docs",
      "oauthClients",
      "apiKeys",
      "vendors",
      "coworkers",
      "tasks",
    ]);
  });
});

describe("DEVELOPER_TAB_REDIRECTS", () => {
  it("maps legacy tab query values to routes", () => {
    expect(DEVELOPER_TAB_REDIRECTS.coworkers).toBe("/developer/coworkers");
    expect(DEVELOPER_TAB_REDIRECTS.mcp).toBe("/connections?tab=mcp");
  });
});
