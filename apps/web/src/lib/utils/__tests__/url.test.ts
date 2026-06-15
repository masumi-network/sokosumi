import { afterEach, describe, expect, it, vi } from "vitest";

import { buildAuthCallbackUrl, getFileNameFromUrl } from "../url";

describe("getFileNameFromUrl", () => {
  it("returns the last pathname segment for a valid URL", () => {
    expect(getFileNameFromUrl("https://example.com/path/to/report.pdf")).toBe(
      "report.pdf",
    );
  });

  it("returns empty string when the path ends with a slash", () => {
    expect(getFileNameFromUrl("https://example.com/foo/")).toBe("");
  });

  it("falls back to splitting the string when URL parsing fails", () => {
    expect(getFileNameFromUrl("not-a-url/but/filename.txt")).toBe(
      "filename.txt",
    );
  });
});

describe("buildAuthCallbackUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("anchors the callback to the current web origin so Core redirects back to the web app", () => {
    vi.stubGlobal("window", {
      location: { origin: "https://preprod.sokosumi.com" },
    });

    expect(buildAuthCallbackUrl("/auth/callback/signin", "google")).toBe(
      "https://preprod.sokosumi.com/auth/callback/signin?provider=google",
    );
  });

  it("includes the returnUrl when provided", () => {
    vi.stubGlobal("window", {
      location: { origin: "https://preprod.sokosumi.com" },
    });

    expect(
      buildAuthCallbackUrl("/auth/callback/signup", "microsoft", "/chat"),
    ).toBe(
      "https://preprod.sokosumi.com/auth/callback/signup?provider=microsoft&returnUrl=%2Fchat",
    );
  });

  it("sanitizes external returnUrl to fallback", () => {
    vi.stubGlobal("window", {
      location: { origin: "https://preprod.sokosumi.com" },
    });

    expect(
      buildAuthCallbackUrl(
        "/auth/callback/signin",
        "google",
        "https://evil.example/attack",
      ),
    ).toBe(
      "https://preprod.sokosumi.com/auth/callback/signin?provider=google&returnUrl=%2F",
    );
  });

  it("falls back to a relative path when window is unavailable (SSR)", () => {
    vi.stubGlobal("window", undefined);

    expect(buildAuthCallbackUrl("/auth/callback/signin", "google")).toBe(
      "/auth/callback/signin?provider=google",
    );
  });
});
