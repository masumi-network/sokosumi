import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveBaseUrl } from "./base-url.ts";

test("requires E2E_BASE_URL", () => {
  assert.throws(() => resolveBaseUrl({}), /E2E_BASE_URL is required/);
  assert.throws(() => resolveBaseUrl({ E2E_BASE_URL: "  " }), /required/);
});

test("accepts preview, preprod and local hosts, returns the origin", () => {
  for (const url of [
    "https://sokosumi-app-preprod-git-x.preview.sokosumi.com/signin",
    "https://preprod.sokosumi.com",
    "https://web-abc.vercel.app",
    "http://localhost:3000",
  ]) {
    assert.equal(resolveBaseUrl({ E2E_BASE_URL: url }), new URL(url).origin);
  }
});

test("refuses production and unknown hosts", () => {
  for (const url of [
    "https://app.sokosumi.com",
    "https://sokosumi.com",
    "https://www.sokosumi.com",
    "https://sokosumi.com.evil.example",
    "https://example.com",
  ]) {
    assert.throws(
      () => resolveBaseUrl({ E2E_BASE_URL: url }),
      /not an allowed/,
      url,
    );
  }
});

test("refuses a value that is not a URL", () => {
  assert.throws(() => resolveBaseUrl({ E2E_BASE_URL: "nope" }), /not a URL/);
});
