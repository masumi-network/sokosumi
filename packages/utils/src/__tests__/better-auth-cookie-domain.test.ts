import assert from "node:assert/strict";

import { test } from "vitest";

import { resolveCrossSubdomainCookieDomain } from "../better-auth-cookie-domain.js";

test("disables cross-subdomain cookies on localhost", () => {
  assert.equal(
    resolveCrossSubdomainCookieDomain("http://localhost:3000/auth"),
    undefined,
  );
});

test("uses the root sokosumi.com domain for mainnet web and core hosts", () => {
  assert.equal(
    resolveCrossSubdomainCookieDomain("https://app.sokosumi.com/auth"),
    "sokosumi.com",
  );
  assert.equal(
    resolveCrossSubdomainCookieDomain("https://api.sokosumi.com/auth"),
    "sokosumi.com",
  );
});

test("uses the preprod subdomain for preprod web and core hosts", () => {
  assert.equal(
    resolveCrossSubdomainCookieDomain("https://preprod.sokosumi.com/auth"),
    "preprod.sokosumi.com",
  );
  assert.equal(
    resolveCrossSubdomainCookieDomain("https://api.preprod.sokosumi.com/auth"),
    "preprod.sokosumi.com",
  );
});

test("pins preview deployments to preview.sokosumi.com", () => {
  assert.equal(
    resolveCrossSubdomainCookieDomain(
      "https://feature-123.preview.sokosumi.com/auth",
    ),
    "preview.sokosumi.com",
  );
  assert.equal(
    resolveCrossSubdomainCookieDomain(
      "https://api.feature-123.preview.sokosumi.com/auth",
    ),
    "preview.sokosumi.com",
  );
  assert.equal(
    resolveCrossSubdomainCookieDomain("https://preview.sokosumi.com/auth"),
    "preview.sokosumi.com",
  );
});

test("ignores non-sokosumi hosts", () => {
  assert.equal(
    resolveCrossSubdomainCookieDomain("https://example.com/auth"),
    undefined,
  );
});
