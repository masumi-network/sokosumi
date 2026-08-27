import { assert, test } from "vitest";

import {
  resolveBetterAuthCookieName,
  resolveBetterAuthCookiePrefix,
} from "./better-auth-cookie-prefix.js";

test("uses the production cookie prefix for mainnet deployments", () => {
  assert.equal(
    resolveBetterAuthCookiePrefix({
      network: "Mainnet",
      vercelEnv: "production",
    }),
    "sokosumi",
  );
  assert.equal(
    resolveBetterAuthCookiePrefix({
      network: "Mainnet",
      vercelEnv: "production",
    }),
    "sokosumi",
  );
});

test("uses the preprod cookie prefix for preprod deployments", () => {
  assert.equal(
    resolveBetterAuthCookiePrefix({
      network: "Preprod",
      vercelEnv: "production",
    }),
    "sokosumi-preprod",
  );
  assert.equal(
    resolveBetterAuthCookiePrefix({
      network: "Preprod",
      vercelEnv: "production",
    }),
    "sokosumi-preprod",
  );
});

test("uses a preview key from the git commit ref", () => {
  const cookiePrefix = resolveBetterAuthCookiePrefix({
    network: "Preprod",
    vercelEnv: "preview",
    vercelGitCommitRef: "feature/123",
  });

  assert.equal(cookiePrefix, "sokosumi-preview-preprod-feature-123");
  assert.equal(
    resolveBetterAuthCookieName(
      {
        network: "Preprod",
        vercelEnv: "preview",
        vercelGitCommitRef: "feature/123",
      },
      "last_used_login_method",
    ),
    "sokosumi-preview-preprod-feature-123.last_used_login_method",
  );
});

test("uses different preview prefixes across different networks", () => {
  const webCookiePrefix = resolveBetterAuthCookiePrefix({
    network: "Preprod",
    vercelEnv: "preview",
    vercelGitCommitRef: "feature/123",
  });
  const coreCookiePrefix = resolveBetterAuthCookiePrefix({
    network: "Mainnet",
    vercelEnv: "preview",
    vercelGitCommitRef: "feature/123",
  });

  assert.equal(webCookiePrefix, "sokosumi-preview-preprod-feature-123");
  assert.equal(coreCookiePrefix, "sokosumi-preview-mainnet-feature-123");
});

test("uses the git commit ref when preview env is enabled", () => {
  const webCookiePrefix = resolveBetterAuthCookiePrefix({
    network: "Preprod",
    vercelEnv: "preview",
    vercelGitCommitRef: "feature_branch-123-team",
  });
  const coreCookiePrefix = resolveBetterAuthCookiePrefix({
    network: "Preprod",
    vercelEnv: "preview",
    vercelGitCommitRef: "feature_branch-123-team",
  });

  assert.equal(
    webCookiePrefix,
    "sokosumi-preview-preprod-feature-branch-123-team",
  );
  assert.equal(
    coreCookiePrefix,
    "sokosumi-preview-preprod-feature-branch-123-team",
  );
});

test("preview prefixes include the configured network", () => {
  const previewPrefix = resolveBetterAuthCookiePrefix({
    network: "Mainnet",
    vercelEnv: "preview",
    vercelGitCommitRef: "different-branch-name",
  });
  assert.equal(previewPrefix, "sokosumi-preview-mainnet-different-branch-name");
});

test("falls back to a network-specific preview prefix when commit ref is empty", () => {
  assert.equal(
    resolveBetterAuthCookiePrefix({
      network: "Preprod",
      vercelEnv: "preview",
      vercelGitCommitRef: "",
    }),
    "sokosumi-preview-preprod",
  );
});

test("collapses repeated separators in preview commit refs", () => {
  assert.equal(
    resolveBetterAuthCookiePrefix({
      network: "Mainnet",
      vercelEnv: "preview",
      vercelGitCommitRef: "---feature___branch---123---",
    }),
    "sokosumi-preview-mainnet-feature-branch-123",
  );
});

test("uses a localhost prefix outside Vercel deployments", () => {
  assert.equal(
    resolveBetterAuthCookiePrefix({
      network: "Preprod",
    }),
    "sokosumi-localhost-preprod",
  );
  assert.equal(
    resolveBetterAuthCookiePrefix({
      network: "Mainnet",
      vercelEnv: "development",
    }),
    "sokosumi-localhost-mainnet",
  );
});
