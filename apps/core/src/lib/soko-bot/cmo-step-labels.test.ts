import { SOKO_BOT_CAPABILITIES } from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";
import { cmoCapabilityLabel } from "./cmo-step-labels";

describe("cmoCapabilityLabel", () => {
  it("says what Cuso is doing in CMO's words", () => {
    expect(cmoCapabilityLabel("find_style_references")).toBe(
      "Looking for a picture style",
    );
    expect(cmoCapabilityLabel("list_social_post_statistics")).toBe(
      "Checking your numbers",
    );
    expect(cmoCapabilityLabel("create_newsletter_issue")).toBe(
      "Working on the newsletter",
    );
    expect(cmoCapabilityLabel("create_ad_campaign")).toBe("Working on an ad");
    expect(cmoCapabilityLabel(null)).toBe("Working");
  });

  it("never shows a tool's name or a Sokosumi feature", () => {
    for (const capability of [...SOKO_BOT_CAPABILITIES, "some_new_tool"]) {
      const label = cmoCapabilityLabel(capability);
      expect(label, capability).not.toContain("_");
      expect(label, capability).not.toMatch(
        /\b(Task|Coworker|Agent|Job|Sokosumi|Jev|Soko Bot)s?\b/,
      );
    }
  });
});
