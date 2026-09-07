import { describe, expect, it } from "vitest";

import {
  getCanonicalWebAppHost,
  getCanonicalWebAppUrl,
} from "./web-app-url.js";

describe("getCanonicalWebAppUrl", () => {
  it("answers the production domain per network", () => {
    expect(getCanonicalWebAppUrl("Mainnet")).toBe("https://app.sokosumi.com");
    expect(getCanonicalWebAppUrl("Preprod")).toBe(
      "https://preprod.sokosumi.com",
    );
  });

  it("has no trailing slash to collapse when a path is appended", () => {
    for (const network of ["Mainnet", "Preprod"] as const) {
      expect(getCanonicalWebAppUrl(network).endsWith("/")).toBe(false);
    }
  });
});

describe("getCanonicalWebAppHost", () => {
  it("drops the scheme so it compares against a request Host header", () => {
    expect(getCanonicalWebAppHost("Mainnet")).toBe("app.sokosumi.com");
    expect(getCanonicalWebAppHost("Preprod")).toBe("preprod.sokosumi.com");
  });
});
