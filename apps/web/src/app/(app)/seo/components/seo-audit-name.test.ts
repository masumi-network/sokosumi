import { describe, expect, it } from "vitest";
import {
  SEO_AUDIT_NAME_MAX,
  seoAuditName,
  seoAuditNameIsHome,
} from "./seo-audit-name";

describe("seoAuditName", () => {
  it("keeps a typed name", () => {
    expect(seoAuditName("  Launch pages ", "https://example.test/a")).toBe(
      "Launch pages",
    );
  });

  it("falls back to the page host without www", () => {
    expect(seoAuditName(" ", "https://www.shop.example.test/a?b=1")).toBe(
      "shop.example.test",
    );
  });

  it("cuts a long host to the Core limit and gives nothing for a bad URL", () => {
    const host = `${"a".repeat(120)}.test`;
    expect(seoAuditName("", `https://${host}/`)).toHaveLength(
      SEO_AUDIT_NAME_MAX,
    );
    expect(seoAuditName("", "not a url")).toBe("");
  });
});

describe("seoAuditName without URL.parse", () => {
  it("still finds the host on browsers that lack URL.parse", () => {
    const parse = URL.parse;
    try {
      Object.defineProperty(URL, "parse", {
        value: undefined,
        configurable: true,
      });
      expect(seoAuditName("", "https://www.example.test/a")).toBe(
        "example.test",
      );
    } finally {
      Object.defineProperty(URL, "parse", { value: parse, configurable: true });
    }
  });
});

describe("seoAuditNameIsHome", () => {
  it("is true only for the host of a home page", () => {
    expect(
      seoAuditNameIsHome(
        "battery-sensei.app",
        "https://www.battery-sensei.app/",
      ),
    ).toBe(true);
    expect(
      seoAuditNameIsHome(
        "battery-sensei.app",
        "https://battery-sensei.app/pricing",
      ),
    ).toBe(false);
    expect(
      seoAuditNameIsHome(
        "battery-sensei.app",
        "https://battery-sensei.app/?ref=a",
      ),
    ).toBe(false);
    expect(
      seoAuditNameIsHome("Launch pages", "https://battery-sensei.app/"),
    ).toBe(false);
    expect(seoAuditNameIsHome("x", "not a url")).toBe(false);
  });
});
