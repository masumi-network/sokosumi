import { describe, expect, it } from "vitest";
import { seoAnalyticsState } from "./seo-agent-statistics-model";

const idle = {
  collected: false,
  loading: false,
  failed: false,
  needsProperty: false,
};

describe("seoAnalyticsState", () => {
  it("reads a connection that is not finished as none, so the line keeps its connect button", () => {
    expect(
      seoAnalyticsState({ status: "pending", sync: idle, properties: null }),
    ).toBe("missing");
  });

  it("names a failed read before a property to choose", () => {
    expect(
      seoAnalyticsState({
        status: "connected",
        sync: { ...idle, failed: true, needsProperty: true },
        properties: 3,
      }),
    ).toBe("failed");
  });

  it("keeps a property to choose while a refetch runs", () => {
    expect(
      seoAnalyticsState({
        status: "connected",
        sync: { ...idle, needsProperty: true, loading: true },
        properties: 3,
      }),
    ).toBe("choose");
  });

  it("says no visits only after a collection finished, also while it refetches", () => {
    const connected = { status: "connected", properties: 1 } as const;
    expect(
      seoAnalyticsState({ ...connected, sync: { ...idle, loading: true } }),
    ).toBe("loading");
    expect(
      seoAnalyticsState({
        ...connected,
        sync: { ...idle, loading: true, collected: true },
      }),
    ).toBe("empty");
    expect(seoAnalyticsState({ ...connected, sync: idle })).toBe("unknown");
  });
});
