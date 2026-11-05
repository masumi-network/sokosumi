import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isFirstPartyAppUrl,
  resolveCorsAllowOrigin,
} from "./cors-allow-origin.js";

const getEnvMock = vi.fn();

vi.mock("@/config/env", () => ({
  getEnv: () => getEnvMock(),
}));

describe("resolveCorsAllowOrigin", () => {
  beforeEach(() => {
    getEnvMock.mockReturnValue({ NODE_ENV: "production" });
  });

  it("allows https sokosumi.com apex", () => {
    expect(resolveCorsAllowOrigin("https://sokosumi.com")).toBe(
      "https://sokosumi.com",
    );
  });

  it("allows https subdomains of sokosumi.com", () => {
    expect(resolveCorsAllowOrigin("https://app.preprod.sokosumi.com")).toBe(
      "https://app.preprod.sokosumi.com",
    );
  });

  it("allows branch preview origins on preview.sokosumi.com", () => {
    const origin =
      "https://sokosumi-app-preprod-git-fix-web-preview-core-url.preview.sokosumi.com";

    expect(resolveCorsAllowOrigin(origin)).toBe(origin);
  });

  it("rejects http for sokosumi.com hosts", () => {
    expect(resolveCorsAllowOrigin("http://app.sokosumi.com")).toBeNull();
  });

  it("rejects non-sokosumi origins in production", () => {
    expect(resolveCorsAllowOrigin("https://evil.example")).toBeNull();
  });

  it("rejects empty origin", () => {
    expect(resolveCorsAllowOrigin("")).toBeNull();
  });

  it("rejects malformed origin", () => {
    expect(resolveCorsAllowOrigin("not a url")).toBeNull();
  });

  it("allows localhost in development", () => {
    getEnvMock.mockReturnValue({ NODE_ENV: "development" });
    expect(resolveCorsAllowOrigin("http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
  });

  it("allows https localhost in development", () => {
    getEnvMock.mockReturnValue({ NODE_ENV: "development" });
    expect(resolveCorsAllowOrigin("https://localhost")).toBe(
      "https://localhost",
    );
  });

  it("allows portless named .localhost origins in development", () => {
    getEnvMock.mockReturnValue({ NODE_ENV: "development" });
    expect(resolveCorsAllowOrigin("https://web.sokosumi.localhost")).toBe(
      "https://web.sokosumi.localhost",
    );
    expect(resolveCorsAllowOrigin("https://main.web.sokosumi.localhost")).toBe(
      "https://main.web.sokosumi.localhost",
    );
    expect(resolveCorsAllowOrigin("http://core.sokosumi.localhost:1355")).toBe(
      "http://core.sokosumi.localhost:1355",
    );
  });

  it("rejects named .localhost origins when not in development", () => {
    getEnvMock.mockReturnValue({ NODE_ENV: "production" });
    expect(resolveCorsAllowOrigin("https://web.sokosumi.localhost")).toBeNull();
  });

  it("rejects localhost when not in development", () => {
    getEnvMock.mockReturnValue({ NODE_ENV: "production" });
    expect(resolveCorsAllowOrigin("http://localhost:3000")).toBeNull();
  });
});

describe("isFirstPartyAppUrl", () => {
  beforeEach(() => {
    getEnvMock.mockReturnValue({ NODE_ENV: "production" });
  });

  it("accepts Sokosumi, CMO.xyz and their previews, nothing else", () => {
    expect(isFirstPartyAppUrl("https://app.cmo.xyz/connect/callback")).toBe(
      true,
    );
    expect(
      isFirstPartyAppUrl(
        "https://sokosumi-cmo-git-x.preview.cmo.xyz/connect/callback",
      ),
    ).toBe(true);
    expect(
      isFirstPartyAppUrl("https://app.sokosumi.com/composio/callback"),
    ).toBe(true);
    expect(isFirstPartyAppUrl("https://evil.example/cmo.xyz")).toBe(false);
    expect(isFirstPartyAppUrl("http://app.cmo.xyz/connect/callback")).toBe(
      false,
    );
    expect(isFirstPartyAppUrl("https://cmo.xyz.evil.example/")).toBe(false);
    expect(isFirstPartyAppUrl("http://localhost:3100/connect/callback")).toBe(
      false,
    );
  });

  it("accepts local dev hosts in development", () => {
    getEnvMock.mockReturnValue({ NODE_ENV: "development" });
    expect(isFirstPartyAppUrl("http://localhost:3100/connect/callback")).toBe(
      true,
    );
  });
});
