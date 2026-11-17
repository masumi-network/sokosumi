import { describe, expect, it } from "vitest";
import {
  seoAnalyticsAction,
  seoAnalyticsHidden,
  seoAnalyticsState,
} from "./seo-agent-statistics-model";

const idle = {
  collected: false,
  loading: false,
  failed: false,
};

describe("seoAnalyticsState", () => {
  it("reads a connection that is not finished as none, so the line keeps its connect button", () => {
    expect(
      seoAnalyticsState({
        status: "pending",
        sync: idle,
        properties: null,
        picked: false,
      }),
    ).toBe("missing");
  });

  it("names a failed read before a property to choose", () => {
    expect(
      seoAnalyticsState({
        status: "connected",
        sync: { ...idle, failed: true },
        properties: 3,
        picked: false,
      }),
    ).toBe("failed");
  });

  it("keeps a property to choose while a refetch runs, and when no sync runs at all", () => {
    expect(
      seoAnalyticsState({
        status: "connected",
        sync: { ...idle, loading: true },
        properties: 3,
        picked: false,
      }),
    ).toBe("choose");
    // A viewer who cannot sync has a sync that never runs: the property list still names the cause.
    expect(
      seoAnalyticsState({
        status: "connected",
        sync: idle,
        properties: 3,
        picked: false,
      }),
    ).toBe("choose");
    // A list not read yet names no choice.
    expect(
      seoAnalyticsState({
        status: "connected",
        sync: idle,
        properties: null,
        picked: false,
      }),
    ).toBe("unknown");
  });

  it("says no visits only after a collection finished, also while it refetches", () => {
    const connected = {
      status: "connected",
      properties: 1,
      picked: true,
    } as const;
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

  it("lets the connect button speak where connections are not offered", () => {
    expect(
      seoAnalyticsState({
        status: "unavailable",
        sync: idle,
        properties: null,
        picked: false,
      }),
    ).toBe("unknown");
  });
});

describe("seoAnalyticsAction", () => {
  it("offers the fix of each cause, and a choice only where there is one", () => {
    expect(seoAnalyticsAction("missing", false, 0)).toBe("connect");
    expect(seoAnalyticsAction("unknown", false, 0)).toBe("connect");
    expect(seoAnalyticsAction("empty", true, 1)).toBe("manage");
    expect(seoAnalyticsAction("empty", true, 2)).toBe("choose");
  });
});

describe("seoAnalyticsHidden", () => {
  it("leaves a running or failed sync to the upkeep line, and waits for a cause", () => {
    expect(seoAnalyticsHidden("loading", true)).toBe(true);
    expect(seoAnalyticsHidden("failed", true)).toBe(true);
    expect(seoAnalyticsHidden("unknown", true)).toBe(true);
    // Not connected: the connect button speaks.
    expect(seoAnalyticsHidden("unknown", false)).toBe(false);
    expect(seoAnalyticsHidden("choose", true)).toBe(false);
  });
});
