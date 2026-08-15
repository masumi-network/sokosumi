import assert from "node:assert/strict";
import test from "node:test";

import {
  assertVercelProductionBranch,
  checkVercelProductionBranch,
} from "../vercel-production-branch-guard.mjs";

test("allows local builds", () => {
  assert.deepEqual(
    checkVercelProductionBranch({
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "feature/dangerous",
    }),
    { ok: true },
  );
});

test("allows Vercel Preview builds from feature branches", () => {
  assert.deepEqual(
    checkVercelProductionBranch({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "feature/safe-preview",
    }),
    { ok: true },
  );
});

test("allows Vercel Production builds from main", () => {
  assert.deepEqual(
    checkVercelProductionBranch({
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
    }),
    { ok: true },
  );
});

test("rejects Vercel Production builds from feature branches", () => {
  assert.deepEqual(
    checkVercelProductionBranch({
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "x402-6-admin",
    }),
    {
      ok: false,
      message:
        'Refusing Vercel Production build from Git ref "x402-6-admin". Production deployments must use "main".',
    },
  );
});

test("rejects Vercel Production builds without a Git ref", () => {
  assert.deepEqual(
    checkVercelProductionBranch({
      VERCEL: "1",
      VERCEL_ENV: "production",
    }),
    {
      ok: false,
      message:
        'Refusing Vercel Production build without VERCEL_GIT_COMMIT_REF. Production deployments must use "main".',
    },
  );
});

test("treats a blank Production Git ref as missing", () => {
  assert.equal(
    checkVercelProductionBranch({
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "   ",
    }).ok,
    false,
  );
});

test("assertion stops a feature-branch Production build", () => {
  assert.throws(
    () =>
      assertVercelProductionBranch({
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_GIT_COMMIT_REF: "x402-6-admin",
      }),
    /Refusing Vercel Production build from Git ref "x402-6-admin"/,
  );
});
