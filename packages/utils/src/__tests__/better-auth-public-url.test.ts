import assert from "node:assert/strict";

import { test } from "vitest";

import {
  resolveBetterAuthProductionUrl,
  resolveBetterAuthPublicBaseUrl,
} from "../better-auth-public-url.js";

test("preview uses VERCEL_URL when set", () => {
  assert.equal(
    resolveBetterAuthPublicBaseUrl({
      vercelEnv: "preview",
      vercelUrl: "https://my-app-abc123.vercel.app",
      vercelBranchUrl: "https://my-app-git-main-team.vercel.app",
      vercelProductionUrl: undefined,
      fallbackUrl: "https://app.example.com",
    }),
    "https://my-app-abc123.vercel.app",
  );
});

test("preview falls back to VERCEL_BRANCH_URL when deployment URL missing", () => {
  assert.equal(
    resolveBetterAuthPublicBaseUrl({
      vercelEnv: "preview",
      vercelUrl: undefined,
      vercelBranchUrl: "https://my-app-git-feature-team.vercel.app",
      vercelProductionUrl: undefined,
      fallbackUrl: "https://app.example.com",
    }),
    "https://my-app-git-feature-team.vercel.app",
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
      fallbackUrl: "http://localhost:3000",
    }),
    "http://localhost:3000",
  );
});

test("development vercelEnv uses fallback URL", () => {
  assert.equal(
    resolveBetterAuthPublicBaseUrl({
      vercelEnv: "development",
      vercelUrl: "https://dev.vercel.app",
      vercelBranchUrl: undefined,
      vercelProductionUrl: undefined,
      fallbackUrl: "http://localhost:3000",
    }),
    "http://localhost:3000",
  );
});

test("strips trailing slashes from result", () => {
  assert.equal(
    resolveBetterAuthPublicBaseUrl({
      vercelEnv: "preview",
      vercelUrl: "https://x.vercel.app///",
      vercelBranchUrl: undefined,
      vercelProductionUrl: undefined,
      fallbackUrl: "https://app.example.com/",
    }),
    "https://x.vercel.app",
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
