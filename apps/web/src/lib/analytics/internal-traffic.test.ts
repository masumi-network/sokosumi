import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  INTERNAL_TRAFFIC_COOKIE,
  isInternalTraffic,
  syncInternalTraffic,
  withoutInternalTrafficParam,
} from "./internal-traffic";

function setLocation(hostname: string, protocol: "http:" | "https:") {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { hostname, protocol },
  });
}

describe("internal traffic", () => {
  beforeEach(() => {
    setLocation("localhost", "http:");
    document.cookie = `${INTERNAL_TRAFFIC_COOKIE}=; Max-Age=0; Path=/`;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is off without the cookie or param", () => {
    expect(syncInternalTraffic("")).toBe(false);
    expect(isInternalTraffic()).toBe(false);
  });

  it("honours a cookie set by the marketing site", () => {
    document.cookie = `${INTERNAL_TRAFFIC_COOKIE}=1; Path=/`;
    expect(syncInternalTraffic("?tab=credits")).toBe(true);
  });

  it("ignores other cookie values", () => {
    document.cookie = `${INTERNAL_TRAFFIC_COOKIE}=10; Path=/`;
    expect(isInternalTraffic()).toBe(false);
  });

  it("sets the cookie on ?internal=1 and clears it on ?internal=0", () => {
    expect(syncInternalTraffic("?internal=1")).toBe(true);
    expect(isInternalTraffic()).toBe(true);

    expect(syncInternalTraffic("?internal=0")).toBe(false);
    expect(isInternalTraffic()).toBe(false);
  });

  it("writes a one-year cookie on the shared .sokosumi.com domain", () => {
    setLocation("app.sokosumi.com", "https:");
    const assignments: string[] = [];
    vi.spyOn(document, "cookie", "set").mockImplementation((value: string) => {
      assignments.push(value);
    });

    syncInternalTraffic("?internal=1");
    syncInternalTraffic("?internal=0");

    expect(assignments[0]).toBe(
      `${INTERNAL_TRAFFIC_COOKIE}=1; Max-Age=31536000; Path=/; SameSite=Lax; domain=.sokosumi.com; Secure`,
    );
    expect(assignments[1]).toBe(
      `${INTERNAL_TRAFFIC_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax; domain=.sokosumi.com; Secure`,
    );
  });
});

describe("withoutInternalTrafficParam", () => {
  it("drops only the internal param", () => {
    expect(
      withoutInternalTrafficParam(
        "https://app.sokosumi.com/billing?internal=1&tab=credits#top",
      ),
    ).toBe("/billing?tab=credits#top");
    expect(
      withoutInternalTrafficParam("https://app.sokosumi.com/?internal=0"),
    ).toBe("/");
  });

  it("returns null when there is nothing to strip", () => {
    expect(
      withoutInternalTrafficParam("https://app.sokosumi.com/billing?tab=x"),
    ).toBeNull();
  });
});
