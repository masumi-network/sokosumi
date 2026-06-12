import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveBetterAuthIssuerCookieDomain,
  resolveBetterAuthRequestCookieDomain,
  shouldClearHostOnlyAuthCookieDuplicate,
} from "../better-auth-cookie-domain.js";

describe("resolveBetterAuthIssuerCookieDomain", () => {
  it("forces localhost in development", () => {
    assert.equal(
      resolveBetterAuthIssuerCookieDomain("sokosumi.com", "development"),
      "localhost",
    );
  });

  it("normalizes production domain", () => {
    assert.equal(
      resolveBetterAuthIssuerCookieDomain(".sokosumi.com", "production"),
      "sokosumi.com",
    );
  });
});

describe("resolveBetterAuthRequestCookieDomain", () => {
  it("uses localhost for local hosts even when production domain is configured", () => {
    assert.equal(
      resolveBetterAuthRequestCookieDomain({
        hostname: "localhost",
        configuredDomain: "sokosumi.com",
      }),
      "localhost",
    );
  });

  it("returns the configured domain for matching subdomains", () => {
    assert.equal(
      resolveBetterAuthRequestCookieDomain({
        hostname: "app.sokosumi.com",
        configuredDomain: "sokosumi.com",
      }),
      "sokosumi.com",
    );
  });

  it("returns undefined for unrelated preview hosts", () => {
    assert.equal(
      resolveBetterAuthRequestCookieDomain({
        hostname: "my-app.example.vercel.app",
        configuredDomain: "sokosumi.com",
      }),
      undefined,
    );
  });

  it("returns undefined without a configured domain on remote hosts", () => {
    assert.equal(
      resolveBetterAuthRequestCookieDomain({
        hostname: "app.example.com",
        configuredDomain: undefined,
      }),
      undefined,
    );
  });
});

describe("shouldClearHostOnlyAuthCookieDuplicate", () => {
  it("skips localhost domains", () => {
    assert.equal(shouldClearHostOnlyAuthCookieDuplicate("localhost"), false);
  });

  it("clears for shared parent domains", () => {
    assert.equal(shouldClearHostOnlyAuthCookieDuplicate("sokosumi.com"), true);
  });
});
