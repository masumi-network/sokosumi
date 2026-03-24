import assert from "node:assert/strict";

import { test } from "vitest";

import {
  getBetterAuthCookieName,
  resolveBetterAuthCookiePrefix,
} from "../better-auth-cookie-prefix.js";

test("uses the production cookie prefix for mainnet hosts", () => {
  assert.equal(
    resolveBetterAuthCookiePrefix({
      baseUrl: "https://app.sokosumi.com/auth",
    }),
    "sokosumi",
  );
  assert.equal(
    resolveBetterAuthCookiePrefix({
      baseUrl: "https://api.sokosumi.com/auth",
    }),
    "sokosumi",
  );
});

test("uses the preprod cookie prefix for preprod hosts", () => {
  assert.equal(
    resolveBetterAuthCookiePrefix({
      baseUrl: "https://preprod.sokosumi.com/auth",
    }),
    "sokosumi-preprod",
  );
  assert.equal(
    resolveBetterAuthCookiePrefix({
      baseUrl: "https://api.preprod.sokosumi.com/auth",
    }),
    "sokosumi-preprod",
  );
});

test("uses a stable preview key from the custom preview host", () => {
  const cookiePrefix = resolveBetterAuthCookiePrefix({
    baseUrl: "https://api.feature-123.preview.sokosumi.com/auth",
  });

  assert.equal(cookiePrefix, "sokosumi-preview-feature-123");
  assert.equal(
    getBetterAuthCookieName(cookiePrefix, "last_used_login_method"),
    "sokosumi-preview-feature-123.last_used_login_method",
  );
});

test("uses the branch URL hostname when the deployment URL is unstable", () => {
  const webCookiePrefix = resolveBetterAuthCookiePrefix({
    baseUrl: "https://deploy-a.vercel.app/auth",
    vercelBranchUrl:
      "https://sokosumi-web-git-feature_branch-123-team.vercel.app",
  });
  const coreCookiePrefix = resolveBetterAuthCookiePrefix({
    baseUrl: "https://deploy-b.vercel.app/auth",
    vercelBranchUrl:
      "https://sokosumi-core-git-feature_branch-123-team.vercel.app",
  });

  assert.equal(webCookiePrefix, "sokosumi-preview-feature-branch-123-team");
  assert.equal(coreCookiePrefix, "sokosumi-preview-feature-branch-123-team");
});

test("falls back to a shared preview prefix when no stable preview key exists", () => {
  assert.equal(
    resolveBetterAuthCookiePrefix({
      baseUrl: "https://preview.sokosumi.com/auth",
    }),
    "sokosumi-preview",
  );
});
