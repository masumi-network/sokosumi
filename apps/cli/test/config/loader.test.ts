import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveCliConfig, sanitizeApiUrl } from "../../src/auth/config.js";
import { loadCliEnvironment } from "../../src/config/loader.js";

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "sokosumi-cli-config-"));
  const cwd = join(root, "cwd");
  const homeDir = join(root, "home");
  const packageRoot = join(root, "package");
  for (const directory of [
    cwd,
    homeDir,
    join(homeDir, ".sokosumi"),
    packageRoot,
  ]) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, ".keep"), "", { flag: "w" });
  }
  return { root, cwd, homeDir, packageRoot };
}

test("merges local env, home preferences, and explicit environment in order", () => {
  const fixture = createFixture();
  try {
    writeFileSync(
      join(fixture.packageRoot, ".env"),
      [
        "SOKOSUMI_API_URL=https://package.example.test",
        "SOKOSUMI_MAINNET_OAUTH_CLIENT_ID=package-client",
      ].join("\n"),
    );
    writeFileSync(
      join(fixture.cwd, ".env"),
      [
        "SOKOSUMI_API_URL=https://cwd.example.test",
        "SOKOSUMI_PREPROD_OAUTH_CLIENT_ID=cwd-client",
      ].join("\n"),
    );
    writeFileSync(
      join(fixture.homeDir, ".sokosumi", "config.json"),
      JSON.stringify({
        apiUrl: "https://home.example.test",
        mainnetOAuthClientId: "home-mainnet-client",
        preprodOAuthClientId: "home-preprod-client",
      }),
    );

    const environment = loadCliEnvironment({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      packageRoot: fixture.packageRoot,
      environment: { SOKOSUMI_API_URL: "https://explicit.example.test" },
    });

    assert.equal(environment.SOKOSUMI_API_URL, "https://explicit.example.test");
    assert.equal(
      environment.SOKOSUMI_MAINNET_OAUTH_CLIENT_ID,
      "home-mainnet-client",
    );
    assert.equal(
      environment.SOKOSUMI_PREPROD_OAUTH_CLIENT_ID,
      "home-preprod-client",
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("TestV23 hosted OAuth resolves legacy web auth proxy to Core auth", () => {
  const fixture = createFixture();
  try {
    writeFileSync(
      join(fixture.homeDir, ".sokosumi", "config.json"),
      JSON.stringify({
        apiUrl: "https://api.sokosumi.com",
        authUrl: "https://app.sokosumi.com/api/auth",
      }),
    );

    const environment = loadCliEnvironment({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      packageRoot: fixture.packageRoot,
      environment: {},
    });

    const mainnetConfig = resolveCliConfig({ env: environment });
    assert.equal(mainnetConfig.authBaseUrl, "https://api.sokosumi.com/auth");

    const preprodConfig = resolveCliConfig({ env: environment, preprod: true });
    assert.equal(preprodConfig.target, "preprod");
    assert.equal(
      preprodConfig.authBaseUrl,
      "https://api.preprod.sokosumi.com/auth",
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("TestV24 hosted OAuth derives auth base from selected target", () => {
  const fixture = createFixture();
  try {
    writeFileSync(
      join(fixture.homeDir, ".sokosumi", "config.json"),
      JSON.stringify({
        apiUrl: "https://api.sokosumi.com",
        authUrl: "https://api.sokosumi.com/auth",
      }),
    );

    const environment = loadCliEnvironment({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      packageRoot: fixture.packageRoot,
      environment: {},
    });

    const preprodConfig = resolveCliConfig({
      env: environment,
      preprod: true,
    });
    assert.equal(
      preprodConfig.authBaseUrl,
      "https://api.preprod.sokosumi.com/auth",
    );

    const customConfig = resolveCliConfig({
      env: environment,
      apiUrl: "https://api.example.test",
      authBaseUrl: "https://auth.example.test",
    });
    assert.equal(customConfig.authBaseUrl, "https://auth.example.test");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("TestV61 canonical API URL sanitizer removes standalone key credentials", () => {
  const apiUrl =
    "https://user:password@host/api?API_KEY=secret&key=key-value&access_key=access-value&region=west&monkey=banana#fragment";

  assert.equal(
    sanitizeApiUrl(apiUrl),
    "https://host/api?region=west&monkey=banana",
  );
  assert.doesNotMatch(
    sanitizeApiUrl(apiUrl),
    /user|password|secret|key-value|access-value|fragment/i,
  );
});

test("does not load secret fields from the home config file", () => {
  const fixture = createFixture();
  try {
    writeFileSync(
      join(fixture.homeDir, ".sokosumi", "config.json"),
      JSON.stringify({
        apiKey: "soko_mainnet_secret",
        authToken: "oauth-secret",
        refreshToken: "refresh-secret",
        mainnetOAuthClientId: "public-client",
      }),
    );

    const environment = loadCliEnvironment({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      packageRoot: fixture.packageRoot,
      environment: {},
    });

    assert.equal(environment.SOKOSUMI_MAINNET_OAUTH_CLIENT_ID, "public-client");
    assert.equal(environment.SOKOSUMI_API_KEY, undefined);
    assert.equal(environment.SOKOSUMI_AUTH_TOKEN, undefined);
    assert.equal(environment.SOKOSUMI_REFRESH_TOKEN, undefined);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("can skip file loading for deterministic command tests", () => {
  const fixture = createFixture();
  try {
    writeFileSync(
      join(fixture.homeDir, ".sokosumi", "config.json"),
      JSON.stringify({ mainnetOAuthClientId: "home-client" }),
    );
    const environment = loadCliEnvironment({
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      packageRoot: fixture.packageRoot,
      environment: { SOKOSUMI_API_URL: "https://explicit.example.test" },
      loadFiles: false,
    });
    assert.deepEqual(environment, {
      SOKOSUMI_API_URL: "https://explicit.example.test",
    });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects malformed home config instead of silently using defaults", () => {
  const fixture = createFixture();
  try {
    writeFileSync(
      join(fixture.homeDir, ".sokosumi", "config.json"),
      "{not-json",
    );
    assert.throws(
      () =>
        loadCliEnvironment({
          cwd: fixture.cwd,
          homeDir: fixture.homeDir,
          packageRoot: fixture.packageRoot,
          environment: {},
        }),
      /Could not parse CLI config file/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
