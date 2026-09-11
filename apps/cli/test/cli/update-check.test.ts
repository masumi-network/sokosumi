import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  checkForUpdate,
  isNpmGlobalInstall,
} from "../../src/cli/update-check.js";

function latestResponse(version: unknown): Response {
  return {
    ok: true,
    json: async () => ({ version }),
  } as Response;
}

const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const npmProbeCommand =
  process.platform === "win32"
    ? process.env.ComSpec || process.env.COMSPEC || "cmd.exe"
    : npmExecutable;
const npmProbeArgs =
  process.platform === "win32"
    ? ["/d", "/s", "/c", "npm.cmd", "root", "--global"]
    : ["root", "--global"];

function dependenciesFor(version: unknown) {
  return {
    interactive: true,
    currentVersion: "2.1.3",
    isGlobalInstall: () => true,
    fetch: async () => latestResponse(version),
  };
}

test("equal current version does not prompt or install", async () => {
  let prompted = false;
  let installed = false;
  const result = await checkForUpdate({
    ...dependenciesFor("2.1.3"),
    prompt: async () => {
      prompted = true;
      return "y";
    },
    npmExec: async () => {
      installed = true;
    },
  });

  assert.equal(result, null);
  assert.equal(prompted, false);
  assert.equal(installed, false);
});

test("TestV48 newer version disables lifecycle scripts and installs exact package", async () => {
  let promptText = "";
  let npmCommand: string | undefined;
  let npmArgs: readonly string[] | undefined;
  let npmOptions: { env: NodeJS.ProcessEnv } | undefined;
  const result = await checkForUpdate({
    ...dependenciesFor("2.1.4"),
    environment: {
      SOKOSUMI_API_KEY: "api-key",
      SOKOSUMI_AUTH_TOKEN: "auth-token",
      SOKOSUMI_ACCESS_TOKEN: "access-token",
      SOKOSUMI_REFRESH_TOKEN: "refresh-token",
      SOKOSUMI_OAUTH_ACCESS_TOKEN: "oauth-access-token",
      SOKOSUMI_OAUTH_REFRESH_TOKEN: "oauth-refresh-token",
      SOKOSUMI_OAUTH_CLIENT_SECRET: "client-secret",
      sOkOsUmI_aPi_KeY: "mixed-case-api-key",
      SOKOSUMI_API_URL: "https://api.example.test",
    },
    prompt: async (message) => {
      promptText = message;
      return "yes";
    },
    npmExec: async (command, args, options) => {
      npmCommand = command;
      npmArgs = args;
      npmOptions = options;
    },
  });

  assert.equal(result, "2.1.4");
  assert.equal(promptText, "Update Sokosumi from v2.1.3 to v2.1.4? [y/N]");
  assert.equal(npmCommand, npmExecutable);
  assert.deepEqual(npmArgs, [
    "install",
    "--global",
    "--ignore-scripts",
    "sokosumi@2.1.4",
  ]);
  assert.ok(npmOptions);
  for (const key of [
    "SOKOSUMI_API_KEY",
    "SOKOSUMI_AUTH_TOKEN",
    "SOKOSUMI_ACCESS_TOKEN",
    "SOKOSUMI_REFRESH_TOKEN",
    "SOKOSUMI_OAUTH_ACCESS_TOKEN",
    "SOKOSUMI_OAUTH_REFRESH_TOKEN",
    "SOKOSUMI_OAUTH_CLIENT_SECRET",
    "sOkOsUmI_aPi_KeY",
  ]) {
    assert.equal(npmOptions.env[key], undefined);
  }
  assert.equal(npmOptions.env.SOKOSUMI_API_URL, undefined);
});

test("TestV48 npm update receives only resolution-safe environment values", async () => {
  let npmEnvironment: NodeJS.ProcessEnv | undefined;
  const result = await checkForUpdate({
    ...dependenciesFor("2.1.4"),
    environment: {
      PATH: "/safe/bin",
      HOME: "/safe/home",
      USERPROFILE: "/safe/profile",
      TMPDIR: "/safe/tmpdir",
      TMP: "/safe/tmp",
      TEMP: "/safe/temp",
      npm_config_prefix: "/safe/prefix",
      AWS_SECRET_ACCESS_KEY: "secret",
      GITHUB_TOKEN: "token",
      NODE_OPTIONS: "--require=malicious.cjs",
      NPM_CONFIG_REGISTRY: "https://attacker.example.test",
      SOKOSUMI_API_KEY: "api-key",
    },
    prompt: async () => "y",
    npmExec: async (_command, _args, options) => {
      npmEnvironment = options.env;
    },
  });

  assert.equal(result, "2.1.4");
  assert.deepEqual(npmEnvironment, {
    PATH: "/safe/bin",
    HOME: "/safe/home",
    USERPROFILE: "/safe/profile",
    TMPDIR: "/safe/tmpdir",
    TMP: "/safe/tmp",
    TEMP: "/safe/temp",
    npm_config_prefix: "/safe/prefix",
  });
});

test("N skips install and continues", async () => {
  let installed = false;
  const result = await checkForUpdate({
    ...dependenciesFor("2.1.4"),
    prompt: async () => "N",
    npmExec: async () => {
      installed = true;
    },
  });

  assert.equal(result, null);
  assert.equal(installed, false);
});

test("fetch failure and invalid metadata fail open", async () => {
  let prompted = false;
  const fetchError = await checkForUpdate({
    ...dependenciesFor("2.1.4"),
    fetch: async () => {
      throw new Error("network down");
    },
    prompt: async () => {
      prompted = true;
      return "y";
    },
  });
  const invalidMetadata = await checkForUpdate({
    ...dependenciesFor("2.1.4-beta.1"),
    prompt: async () => {
      prompted = true;
      return "y";
    },
  });

  assert.equal(fetchError, null);
  assert.equal(invalidMetadata, null);
  assert.equal(prompted, false);
});

test("fetch timeout aborts the request and fails open", async () => {
  let aborted = false;
  let prompted = false;
  const result = await checkForUpdate({
    ...dependenciesFor("2.1.4"),
    fetch: async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("request aborted"));
        });
      }),
    prompt: async () => {
      prompted = true;
      return "y";
    },
  });

  assert.equal(result, null);
  assert.equal(aborted, true);
  assert.equal(prompted, false);
});

test("non-TTY and non-global executions skip the registry call", async () => {
  let fetchCalls = 0;
  const fetch = async () => {
    fetchCalls += 1;
    return latestResponse("2.1.4");
  };
  const nonTty = await checkForUpdate({
    ...dependenciesFor("2.1.4"),

    interactive: false,
    fetch,
  });
  const nonGlobal = await checkForUpdate({
    ...dependenciesFor("2.1.4"),
    isGlobalInstall: () => false,
    fetch,
  });

  assert.equal(nonTty, null);
  assert.equal(nonGlobal, null);
  assert.equal(fetchCalls, 0);
});

test("install failure fails open after prompting", async () => {
  let installed = false;
  const result = await checkForUpdate({
    ...dependenciesFor("2.1.4"),
    prompt: async () => "y",
    npmExec: async () => {
      installed = true;
      throw new Error("npm unavailable");
    },
  });

  assert.equal(result, null);
  assert.equal(installed, true);
});

test("detects a regular package under npm's global root", () => {
  const directory = mkdtempSync(join(tmpdir(), "sokosumi-update-"));
  const globalRootPath = join(directory, "lib", "node_modules");
  const entrypoint = join(
    globalRootPath,
    "sokosumi",
    "dist",
    "bin",
    "sokosumi.js",
  );
  mkdirSync(dirname(entrypoint), { recursive: true });
  writeFileSync(entrypoint, "");
  const globalRoot = realpathSync(globalRootPath);
  let probeTimeout: number | undefined;
  let probeEnvironment: NodeJS.ProcessEnv | undefined;
  const environment = {
    SOKOSUMI_API_KEY: "api-key",
    SOKOSUMI_API_URL: "https://api.example.test",
  };

  const result = isNpmGlobalInstall(
    entrypoint,
    (command, args, options) => {
      assert.equal(command, npmProbeCommand);
      assert.deepEqual(args, npmProbeArgs);
      probeTimeout = options.timeout;
      probeEnvironment = options.env;
      return globalRoot;
    },
    environment,
  );

  assert.equal(result, true);
  assert.equal(probeTimeout, 2_000);
  assert.ok(probeEnvironment);
  assert.equal(probeEnvironment.SOKOSUMI_API_KEY, undefined);
  assert.equal(probeEnvironment.SOKOSUMI_API_URL, undefined);
});

test("detects a package under a symlinked npm global-root parent", () => {
  const directory = mkdtempSync(join(tmpdir(), "sokosumi-update-"));
  const canonicalGlobalRoot = join(directory, "lib", "node_modules");
  mkdirSync(canonicalGlobalRoot, { recursive: true });
  const symlinkedPrefix = join(directory, "linked-prefix");
  symlinkSync(
    join(directory, "lib"),
    symlinkedPrefix,
    process.platform === "win32" ? "junction" : "dir",
  );
  const globalRoot = join(symlinkedPrefix, "node_modules");
  const entrypoint = join(globalRoot, "sokosumi", "dist", "bin", "sokosumi.js");
  mkdirSync(dirname(entrypoint), { recursive: true });
  writeFileSync(entrypoint, "");

  const result = isNpmGlobalInstall(entrypoint, (command, args) => {
    assert.equal(command, npmProbeCommand);
    assert.deepEqual(args, npmProbeArgs);
    return globalRoot;
  });

  assert.equal(result, true);
});

test("rejects a symlinked package under npm's global root", () => {
  const directory = mkdtempSync(join(tmpdir(), "sokosumi-update-"));
  const globalRoot = join(directory, "lib", "node_modules");
  mkdirSync(globalRoot, { recursive: true });
  const packageRoot = join(directory, "linked-package", "sokosumi");
  const entrypoint = join(packageRoot, "dist", "bin", "sokosumi.js");
  mkdirSync(dirname(entrypoint), { recursive: true });
  writeFileSync(entrypoint, "");
  symlinkSync(
    packageRoot,
    join(globalRoot, "sokosumi"),
    process.platform === "win32" ? "junction" : "dir",
  );
  let probeTimeout: number | undefined;

  const result = isNpmGlobalInstall(entrypoint, (command, args, options) => {
    assert.equal(command, npmProbeCommand);
    assert.deepEqual(args, npmProbeArgs);
    probeTimeout = options.timeout;
    return globalRoot;
  });

  assert.equal(result, false);
  assert.equal(probeTimeout, 2_000);
});
