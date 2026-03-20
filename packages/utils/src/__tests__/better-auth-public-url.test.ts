import assert from "node:assert/strict";
import test from "node:test";

import { resolveBetterAuthPublicBaseUrl } from "../better-auth-public-url.js";

test("preview uses VERCEL_URL when set", () => {
  assert.equal(
    resolveBetterAuthPublicBaseUrl({
      vercelEnv: "preview",
      vercelUrl: "https://my-app-abc123.vercel.app",
      vercelBranchUrl: "https://my-app-git-main-team.vercel.app",
      configuredBaseUrl: "https://app.example.com",
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
      configuredBaseUrl: "https://app.example.com",
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
      configuredBaseUrl: "https://app.example.com",
    }),
    "https://my-app-git-feature-team.vercel.app",
  );
});

test("preview falls back to configured base URL when both Vercel URLs are empty strings", () => {
  assert.equal(
    resolveBetterAuthPublicBaseUrl({
      vercelEnv: "preview",
      vercelUrl: "",
      vercelBranchUrl: "",
      configuredBaseUrl: "https://app.example.com",
    }),
    "https://app.example.com",
  );
});

test("preview falls back to configured base URL when both Vercel URLs missing", () => {
  assert.equal(
    resolveBetterAuthPublicBaseUrl({
      vercelEnv: "preview",
      vercelUrl: undefined,
      vercelBranchUrl: undefined,
      configuredBaseUrl: "https://app.example.com",
    }),
    "https://app.example.com",
  );
});

test("production uses configured base URL", () => {
  assert.equal(
    resolveBetterAuthPublicBaseUrl({
      vercelEnv: "production",
      vercelUrl: "https://ignored.vercel.app",
      vercelBranchUrl: "https://ignored-git-main.vercel.app",
      configuredBaseUrl: "https://app.example.com",
    }),
    "https://app.example.com",
  );
});

test("undefined vercelEnv uses configured base URL", () => {
  assert.equal(
    resolveBetterAuthPublicBaseUrl({
      vercelEnv: undefined,
      vercelUrl: "https://preview.vercel.app",
      vercelBranchUrl: undefined,
      configuredBaseUrl: "http://localhost:3000",
    }),
    "http://localhost:3000",
  );
});

test("development vercelEnv uses configured base URL", () => {
  assert.equal(
    resolveBetterAuthPublicBaseUrl({
      vercelEnv: "development",
      vercelUrl: "https://dev.vercel.app",
      vercelBranchUrl: undefined,
      configuredBaseUrl: "http://localhost:3000",
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
      configuredBaseUrl: "https://app.example.com/",
    }),
    "https://x.vercel.app",
  );
});
