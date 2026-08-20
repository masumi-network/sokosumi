import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveCorsAllowOrigin } from "../cors-allow-origin.js";

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
