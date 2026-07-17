import assert from "node:assert/strict";

import { test } from "vitest";

import {
  isSokosumiAuthHost,
  resolveBetterAuthProductionUrl,
  resolveBetterAuthPublicBaseUrl,
} from "../better-auth-public-url.js";

test("preview prefers preferredPreviewUrl when set", () => {
  assert.equal(
    resolveBetterAuthPublicBaseUrl({
      vercelEnv: "preview",
      preferredPreviewUrl:
        "https://sokosumi-core-preprod-git-feature.preview.sokosumi.com",
      vercelUrl: "https://my-app-abc123.vercel.app",
      vercelBranchUrl: "https://my-app-git-feature-team.vercel.app",
      vercelProductionUrl: undefined,
      fallbackUrl: "https://app.example.com",
    }),
    "https://sokosumi-core-preprod-git-feature.preview.sokosumi.com",
  );
});

test("preview prefers sokosumi branch URL over vercel.app deployment URL", () => {
  assert.equal(
    resolveBetterAuthPublicBaseUrl({
      vercelEnv: "preview",
      vercelUrl: "https://my-app-abc123.vercel.app",
      vercelBranchUrl:
        "https://sokosumi-core-preprod-git-feature.preview.sokosumi.com",
      vercelProductionUrl: undefined,
      fallbackUrl: "https://app.example.com",
    }),
    "https://sokosumi-core-preprod-git-feature.preview.sokosumi.com",
  );
});

test("preview falls back to VERCEL_BRANCH_URL when preferred host missing", () => {
  assert.equal(
    resolveBetterAuthPublicBaseUrl({
      vercelEnv: "preview",
      vercelUrl: undefined,
      vercelBranchUrl: "https://my-app-git-main-team.vercel.app",
      vercelProductionUrl: undefined,
      fallbackUrl: "https://app.example.com",
    }),
    "https://my-app-git-main-team.vercel.app",
  );
});

test("preview falls back to VERCEL_URL when branch URL missing", () => {
  assert.equal(
    resolveBetterAuthPublicBaseUrl({
      vercelEnv: "preview",
      vercelUrl: "https://my-app-abc123.vercel.app",
      vercelBranchUrl: undefined,
      vercelProductionUrl: undefined,
      fallbackUrl: "https://app.example.com",
    }),
    "https://my-app-abc123.vercel.app",
  );
});

test("preview falls back to VERCEL_BRANCH_URL when deployment URL is empty string", () => {
  assert.equal(
    resolveBetterAuthPublicBaseUrl({
      vercelEnv: "preview",
      vercelUrl: "",
      vercelBranchUrl: "https://my-app-git-feature-team.vercel.app",
      vercelProductionUrl: undefined,
      fallbackUrl: "https://app.example.com",
    }),
    "https://my-app-git-feature-team.vercel.app",
  );
});

test("preview falls back to fallback URL when both Vercel URLs are empty strings", () => {
  assert.equal(
    resolveBetterAuthPublicBaseUrl({
      vercelEnv: "preview",
      vercelUrl: "",
      vercelBranchUrl: "",
      vercelProductionUrl: undefined,
      fallbackUrl: "https://app.example.com",
    }),
    "https://app.example.com",
  );
});

test("preview falls back to fallback URL when both Vercel URLs missing", () => {
  assert.equal(
    resolveBetterAuthPublicBaseUrl({
      vercelEnv: "preview",
      vercelUrl: undefined,
      vercelBranchUrl: undefined,
      vercelProductionUrl: undefined,
      fallbackUrl: "https://app.example.com",
    }),
    "https://app.example.com",
  );
});

test("production uses vercelProductionUrl when set", () => {
  assert.equal(
    resolveBetterAuthPublicBaseUrl({
      vercelEnv: "production",
      vercelUrl: "https://ignored.vercel.app",
      vercelBranchUrl: "https://ignored-git-main.vercel.app",
      vercelProductionUrl: "https://core.example.com",
      fallbackUrl: "https://app.example.com",
    }),
    "https://core.example.com",
  );
});

test("production uses fallback URL when vercelProductionUrl missing", () => {
  assert.equal(
    resolveBetterAuthPublicBaseUrl({
      vercelEnv: "production",
      vercelUrl: "https://ignored.vercel.app",
      vercelBranchUrl: "https://ignored-git-main.vercel.app",
      vercelProductionUrl: undefined,
      fallbackUrl: "https://app.example.com",
    }),
    "https://app.example.com",
  );
});

test("undefined vercelEnv uses fallback URL", () => {
  assert.equal(
    resolveBetterAuthPublicBaseUrl({
      vercelEnv: undefined,
      vercelUrl: "https://preview.vercel.app",
      vercelBranchUrl: undefined,
      vercelProductionUrl: undefined,
      fallbackUrl: "[REDACTED]",
    }),
    "[REDACTED]",
  );
});

test("development vercelEnv uses fallback URL", () => {
  assert.equal(
    resolveBetterAuthPublicBaseUrl({
      vercelEnv: "development",
      vercelUrl: "https://dev.vercel.app",
      vercelBranchUrl: undefined,
      vercelProductionUrl: undefined,
      fallbackUrl: "[REDACTED]",
    }),
    "[REDACTED]",
  );
});

test("strips trailing slashes from result", () => {
  assert.equal(
    resolveBetterAuthPublicBaseUrl({
      vercelEnv: "preview",
      preferredPreviewUrl:
        "https://sokosumi-core-preprod-git-x.preview.sokosumi.com///",
      vercelUrl: "https://x.vercel.app///",
      vercelBranchUrl: undefined,
      vercelProductionUrl: undefined,
      fallbackUrl: "https://app.example.com/",
    }),
    "https://sokosumi-core-preprod-git-x.preview.sokosumi.com",
  );
});

test("production URL uses VERCEL_PROJECT_PRODUCTION_URL when set", () => {
  assert.equal(
    resolveBetterAuthProductionUrl({
      vercelProductionUrl: "https://core.example.com///",
      fallbackUrl: "https://stale.example.com/auth",
    }),
    "https://core.example.com",
  );
});

test("production URL falls back to fallback URL when Vercel URL missing", () => {
  assert.equal(
    resolveBetterAuthProductionUrl({
      vercelProductionUrl: undefined,
      fallbackUrl: "https://app.example.com/auth/",
    }),
    "https://app.example.com/auth",
  );
});

test("isSokosumiAuthHost accepts preview and apex hosts", () => {
  assert.equal(
    isSokosumiAuthHost(
      "https://sokosumi-core-preprod-git-x.preview.sokosumi.com",
    ),
    true,
  );
  assert.equal(isSokosumiAuthHost("api.preprod.sokosumi.com"), true);
  assert.equal(isSokosumiAuthHost("https://my-app.vercel.app"), false);
});
