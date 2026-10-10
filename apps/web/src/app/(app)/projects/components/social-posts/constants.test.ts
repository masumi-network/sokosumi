import { describe, expect, it } from "vitest";

import { SECTION_ORDER, SECTION_STATUSES, SOCIAL_TABS } from "./constants";

describe("Social list tabs", () => {
  it("keeps drafts and Needs attention as the only post lists", () => {
    expect(SECTION_ORDER).toEqual(["drafts", "attention"]);
    expect(SECTION_STATUSES.drafts).toEqual(["DRAFT"]);
    expect(SECTION_STATUSES.attention).toEqual(["FAILED", "MISSED"]);
  });

  it("puts calendar first and accounts last on Social's own page", () => {
    expect(SOCIAL_TABS).toEqual([
      "calendar",
      "drafts",
      "attention",
      "statistics",
      "accounts",
    ]);
  });
});
