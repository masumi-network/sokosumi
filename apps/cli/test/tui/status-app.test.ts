import assert from "node:assert/strict";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { type Instance, render as inkRender } from "ink";
import packageJson from "../../package.json" with { type: "json" };
import type { CoreHttpClient } from "../../src/api/http-client.js";
import {
  AuthManager,
  type OAuthCredentials,
} from "../../src/auth/auth-manager.js";
import type { CliTargetConfig } from "../../src/auth/config.js";
import {
  type BrowserLoginOptions,
  DEFAULT_OAUTH_REDIRECT_PATH,
  DEFAULT_OAUTH_REDIRECT_PORT,
  OAUTH_LOOPBACK_HOST,
} from "../../src/auth/oauth.js";
import { runCli } from "../../src/cli/index.js";
import { CLI_VERSION } from "../../src/cli/metadata.js";
import { redactErrorMessage } from "../../src/error-redaction.js";
import {
  apiKeyCreationHint,
  apiKeyPrefixHint,
  apiKeyTargetEscapeState,
  buildSignInMenuItems,
  canToggleSignInNetwork,
  displayTargetLabel,
  explicitApiKeyTargetError,
  isNetworkSelectionLocked,
  nextSignInNetworkConfig,
  oauthCallbackDisplayUri,
  renderStatusApp,
  resolveHostedTargetConfig,
  resolveStatusCoreClient,
  type StatusAppOptions,
  toggleHostedTarget,
} from "../../src/tui/status-app.js";

test("TUI display values derive from package, config, and OAuth sources", () => {
  assert.equal(CLI_VERSION, packageJson.version);
  assert.equal(apiKeyPrefixHint(), "soko_mainnet_… / soko_preprod_…");
  assert.equal(
    apiKeyCreationHint({
      SOKOSUMI_WEB_URL: "https://user:secret@example.test///",
    }),
    "Create one at https://example.test/connections.",
  );
  assert.equal(
    oauthCallbackDisplayUri(),
    `http://${OAUTH_LOOPBACK_HOST}:${DEFAULT_OAUTH_REDIRECT_PORT}${DEFAULT_OAUTH_REDIRECT_PATH}`,
  );
  assert.equal(
    oauthCallbackDisplayUri(53683, "custom/callback"),
    `http://${OAUTH_LOOPBACK_HOST}:53683/custom/callback`,
  );
});

test("mainnet TUI selection overrides a preprod API URL", () => {
  const config = resolveHostedTargetConfig(
    { SOKOSUMI_API_URL: "https://api.preprod.sokosumi.com" },
    "mainnet",
  );

  assert.equal(config.target, "mainnet");
  assert.equal(config.apiUrl, "https://api.sokosumi.com");
  assert.equal(config.authBaseUrl, "https://api.sokosumi.com/auth");
});

test("TUI explicit target rejects mismatched prefixed API keys", () => {
  const mainnet = resolveHostedTargetConfig({}, "mainnet");
  const preprod = resolveHostedTargetConfig({}, "preprod");

  assert.match(
    explicitApiKeyTargetError("soko_preprod_secret", mainnet, true) || "",
    /belongs to preprod/,
  );
  assert.equal(
    explicitApiKeyTargetError("soko_mainnet_secret", mainnet, true),
    null,
  );
  assert.equal(
    explicitApiKeyTargetError("soko_preprod_secret", preprod, true),
    null,
  );
  assert.equal(
    explicitApiKeyTargetError("soko_preprod_secret", mainnet, false),
    null,
  );
});

test("TUI target labels sanitize API URLs", () => {
  const config: CliTargetConfig = {
    target: "custom",
    apiUrl:
      "https://user:password@example.test/api?API_KEY=secret&region=west#fragment",
    authBaseUrl: "https://example.test/auth",
    clientId: "client",
    clientSecret: "secret",
  };
  const label = displayTargetLabel(config);
  assert.equal(label, "https://example.test/api?region=west");
  assert.doesNotMatch(label, /user|password|secret|fragment/i);
});

test("sign-in menu lists auth methods only; Tab toggles network", () => {
  const items = buildSignInMenuItems();
  assert.deepEqual(
    items.map((item) => item.value),
    ["oauth", "api-key"],
  );
  assert.equal(toggleHostedTarget("mainnet"), "preprod");
  assert.equal(toggleHostedTarget("preprod"), "mainnet");
});

function stubCoreClient(): CoreHttpClient {
  return {
    get: async <T>() => ({}) as T,
    post: async <T>() => ({}) as T,
    patch: async <T>() => ({}) as T,
    delete: async <T>() => ({}) as T,
  };
}

test("status core client reuses override only while API URLs match", () => {
  const primary = stubCoreClient();
  const created = stubCoreClient();
  let createCount = 0;

  const reused = resolveStatusCoreClient({
    coreClientOverride: primary,
    selectedApiUrl: "https://api.sokosumi.com",
    configApiUrl: "https://api.sokosumi.com",
    createClient: () => {
      createCount += 1;
      return created;
    },
  });
  assert.equal(reused, primary);
  assert.equal(createCount, 0);

  const switched = resolveStatusCoreClient({
    coreClientOverride: primary,
    selectedApiUrl: "https://api.preprod.sokosumi.com",
    configApiUrl: "https://api.sokosumi.com",
    createClient: () => {
      createCount += 1;
      return created;
    },
  });
  assert.equal(switched, created);
  assert.equal(createCount, 1);

  const withoutOverride = resolveStatusCoreClient({
    selectedApiUrl: "https://api.sokosumi.com",
    configApiUrl: "https://api.sokosumi.com",
    createClient: () => {
      createCount += 1;
      return created;
    },
  });
  assert.equal(withoutOverride, created);
  assert.equal(createCount, 2);
});

test("Tab network toggle is scoped to unlocked auth-method screen", () => {
  assert.equal(
    canToggleSignInNetwork({
      route: "auth",
      screen: "auth-method",
      networkSelectionLocked: false,
      busy: false,
    }),
    true,
  );
  assert.equal(
    canToggleSignInNetwork({
      route: "auth",
      screen: "auth-method",
      networkSelectionLocked: true,
      busy: false,
    }),
    false,
  );
  assert.equal(
    canToggleSignInNetwork({
      route: "auth",
      screen: "auth-method",
      networkSelectionLocked: false,
      busy: true,
    }),
    false,
  );
  assert.equal(
    canToggleSignInNetwork({
      route: "signed-in",
      screen: "home",
      networkSelectionLocked: false,
      busy: false,
    }),
    false,
  );

  const mainnet = resolveHostedTargetConfig({}, "mainnet");
  const preprod = nextSignInNetworkConfig(mainnet, {}, undefined);
  assert.equal(preprod.target, "preprod");
});

test("env default mainnet URL does not lock TUI network selection", () => {
  const config = resolveHostedTargetConfig(
    { SOKOSUMI_API_URL: "https://api.sokosumi.com" },
    "mainnet",
  );
  assert.equal(isNetworkSelectionLocked(config, { preprod: false }), false);
  assert.equal(isNetworkSelectionLocked(config, { preprod: true }), true);
  assert.equal(
    isNetworkSelectionLocked(
      {
        target: "custom",
        apiUrl: "https://api.example.test",
        authBaseUrl: "https://api.example.test/auth",
        clientId: "client",
        clientSecret: "",
      },
      {},
    ),
    true,
  );
});

test("env SOKOSUMI_API_URL still validates mismatched API keys when network is unlocked", () => {
  const env = { SOKOSUMI_API_URL: "https://api.sokosumi.com" };
  const config = resolveHostedTargetConfig(env, "mainnet");
  const targetExplicit = Boolean(env.SOKOSUMI_API_URL);

  assert.equal(isNetworkSelectionLocked(config, {}), false);
  assert.equal(targetExplicit, true);
  assert.match(
    explicitApiKeyTargetError("soko_preprod_secret", config, targetExplicit) ||
      "",
    /belongs to preprod/,
  );
  assert.equal(
    explicitApiKeyTargetError("soko_mainnet_secret", config, targetExplicit),
    null,
  );
  assert.equal(
    explicitApiKeyTargetError("soko_preprod_secret", config, false),
    null,
    "callers must pass targetExplicit=true when SOKOSUMI_API_URL is set",
  );
});

test("TUI errors redact credential-shaped values", () => {
  assert.equal(
    redactErrorMessage(
      new Error("apiKey=soko_mainnet_secret accessToken=access-secret"),
    ),
    "apiKey: [REDACTED] accessToken: [REDACTED]",
  );
});

test("Ink solely owns API-key input and Esc/arrow navigation", async () => {
  const terminal = createTestTerminal();
  let output = "";
  terminal.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  let instance: Instance | undefined;
  const render: NonNullable<StatusAppOptions["render"]> = (node) => {
    const nextInstance = inkRender(node, {
      debug: true,
      stdin: terminal.stdin,
      stdout: terminal.stdout,
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    });
    instance = nextInstance;
    return nextInstance;
  };
  const cliPromise = runCli([], {
    env: {},
    authManager: createTestAuthManager(),
    tuiFn: (options) => renderStatusApp({ ...options, render }),
  });
  try {
    await waitForOutput(terminal.stdout, () => output, "Browser OAuth");
    assert.match(output, new RegExp(`sokosumi v${CLI_VERSION}`));
    assert.match(output, /soko_mainnet_/);
    await waitForNextImmediate();
    await sendInput(terminal.stdin, "\u001b[B");
    await sendInput(terminal.stdin, "\r");
    await waitForOutput(terminal.stdout, () => output, "Input is hidden");
    await sendInput(terminal.stdin, "q");
    await sendInput(terminal.stdin, "\r");
    await waitForOutput(terminal.stdout, () => output, "Choose API-key target");

    await sendInput(terminal.stdin, "\u001b");
    await sendInput(terminal.stdin, "\u001b[B");
    await sendInput(terminal.stdin, "\r");
    await waitForOutput(terminal.stdout, () => output, "Input is hidden");
    await sendInput(terminal.stdin, "\u001b");
    await sendInput(terminal.stdin, "q");
    await cliPromise;
  } finally {
    instance?.unmount();
    await cliPromise;
    instance?.cleanup();
  }
});

test("API-key target Escape discards the pending key", () => {
  assert.deepEqual(apiKeyTargetEscapeState(), {
    screen: "auth-method",
    pendingApiKey: null,
  });
});

test("OAuth Escape returns to confirm and allows retry", async () => {
  const terminal = createTestTerminal();
  let output = "";
  terminal.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  let loginCalls = 0;
  let savedCredentials = 0;
  const authManager = new AuthManager({
    credentialStore: {
      read: () => null,
      write: (_credentials: OAuthCredentials) => {
        savedCredentials += 1;
      },
      clear: () => {},
    },
    apiKeyStore: {
      read: () => null,
      write: (_credentials) => {},
      clear: () => {},
    },
  });
  let instance: Instance | undefined;
  const render: NonNullable<StatusAppOptions["render"]> = (node) => {
    const nextInstance = inkRender(node, {
      debug: true,
      stdin: terminal.stdin,
      stdout: terminal.stdout,
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    });
    instance = nextInstance;
    return nextInstance;
  };
  const loginResolvers: Array<(credentials: OAuthCredentials) => void> = [];
  const cliPromise = runCli([], {
    env: {},
    authManager,
    loginFn: async () => {
      loginCalls += 1;
      const deferred = createDeferred<OAuthCredentials>();
      loginResolvers.push(deferred.resolve);
      return deferred.promise;
    },
    tuiFn: (options) =>
      renderStatusApp({
        ...options,
        authManagerFactory: () => authManager,
        render,
      }),
  });
  try {
    await waitForOutput(terminal.stdout, () => output, "Browser OAuth");
    await waitForNextImmediate();
    await sendInput(terminal.stdin, "\r");
    await waitForOutput(terminal.stdout, () => output, "Open browser sign-in?");
    assert.doesNotMatch(output, /Choose OAuth target/);
    await waitForNextImmediate();
    await sendInput(terminal.stdin, "\r");
    await waitForNextImmediate();
    assert.equal(loginCalls, 1);

    await sendInput(terminal.stdin, "\u001b");
    loginResolvers[0]?.({
      authToken: "late-token",
      refreshToken: "late-refresh",
    });
    await waitForNextImmediate();
    await waitForNextImmediate();
    assert.equal(savedCredentials, 0);
    assert.doesNotMatch(output, /✓ Sign-in successful/);
    await sendInput(terminal.stdin, "\r");
    await waitForNextImmediate();
    assert.equal(loginCalls, 2);
    await sendInput(terminal.stdin, "\u0003");
    await waitForNextImmediate();
    await waitForNextImmediate();
    await sendInput(terminal.stdin, "\r");
    await waitForNextImmediate();
    assert.equal(loginCalls, 3);
    await sendInput(terminal.stdin, "q");
    await cliPromise;
  } finally {
    instance?.unmount();
    await cliPromise;
    instance?.cleanup();
  }
});

async function waitForOutput(
  stdout: PassThrough,
  getOutput: () => string,
  expected: string,
): Promise<void> {
  while (!getOutput().includes(expected)) {
    await once(stdout, "data");
  }
}

async function waitForNextImmediate(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function sendInput(stdin: PassThrough, input: string): Promise<void> {
  stdin.write(input);
  stdin.emit("readable");
  await waitForNextImmediate();
  if (input === "\u001b") {
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
  }
}

function createTestAuthManager(): AuthManager {
  return new AuthManager({
    credentialStore: {
      read: () => null,
      write: (_credentials: OAuthCredentials) => {},
      clear: () => {},
    },
    apiKeyStore: {
      read: () => null,
      write: (_credentials) => {},
      clear: () => {},
    },
  });
}

type TestStdin = PassThrough & NodeJS.ReadStream;
type TestStdout = PassThrough & NodeJS.WriteStream;

function createTestTerminal(): {
  stdin: TestStdin;
  stdout: TestStdout;
} {
  const stdin = new PassThrough() as TestStdin;
  Object.assign(stdin, {
    isRaw: false,
    isTTY: true,
    ref: () => stdin,
    setRawMode: (_mode: boolean) => stdin,
    unref: () => stdin,
  });
  const stdout = new PassThrough() as TestStdout;
  Object.assign(stdout, {
    columns: 80,
    isTTY: true,
    rows: 24,
  });
  return { stdin, stdout };
}

test("explicit preprod target skips OAuth target picker", async () => {
  const terminal = createTestTerminal();
  let output = "";
  terminal.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  let instance: Instance | undefined;
  const render: NonNullable<StatusAppOptions["render"]> = (node) => {
    const nextInstance = inkRender(node, {
      debug: true,
      stdin: terminal.stdin,
      stdout: terminal.stdout,
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    });
    instance = nextInstance;
    return nextInstance;
  };
  const cliPromise = runCli(["--preprod"], {
    env: {},
    authManager: createTestAuthManager(),
    loginFn: async () => new Promise<never>(() => {}),
    tuiFn: (options) => renderStatusApp({ ...options, render }),
  });
  try {
    await waitForOutput(terminal.stdout, () => output, "Browser OAuth");
    await waitForNextImmediate();
    await sendInput(terminal.stdin, "\r");
    await waitForOutput(terminal.stdout, () => output, "Open browser sign-in?");
    assert.doesNotMatch(output, /Choose OAuth target/);
    assert.match(output, /Target: preprod/);
    await sendInput(terminal.stdin, "\t");
    await waitForNextImmediate();
    await waitForNextImmediate();
    assert.match(output, /Target: preprod/);
    assert.doesNotMatch(output, /Target: mainnet/);
    await sendInput(terminal.stdin, "q");
    await cliPromise;
  } finally {
    instance?.unmount();
    await cliPromise;
    instance?.cleanup();
  }
});

test("runCli TUI selection preserves explicit client ID", async () => {
  const terminal = createTestTerminal();
  let output = "";
  terminal.stdout.on("data", (chunk) => {
    output += String(chunk);
  });

  let instance: Instance | undefined;
  const render: NonNullable<StatusAppOptions["render"]> = (node) => {
    const nextInstance = inkRender(node, {
      debug: true,
      stdin: terminal.stdin,
      stdout: terminal.stdout,
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    });
    instance = nextInstance;
    return nextInstance;
  };

  const loginRequestResolvers = createDeferred<BrowserLoginOptions>();
  const loginRequestPromise = loginRequestResolvers.promise;
  const cliPromise = runCli(
    [
      "--client-id",
      "flag-client",
      "--oauth-port",
      "53683",
      "--oauth-timeout-ms",
      "180000",
    ],
    {
      env: {
        SOKOSUMI_PREPROD_OAUTH_CLIENT_ID: "preprod-environment-client",
      },
      authManager: createTestAuthManager(),
      loginFn: async (request) => {
        loginRequestResolvers.resolve(request);
        return {
          authToken: "access-token",
          refreshToken: "refresh-token",
          expiresAt: "2030-01-01T00:00:00.000Z",
        };
      },
      tuiFn: (options) =>
        renderStatusApp({
          ...options,
          authManagerFactory: () => createTestAuthManager(),
          render,
        }),
    },
  );

  try {
    await waitForOutput(terminal.stdout, () => output, "Browser OAuth");
    await waitForNextImmediate();
    await sendInput(terminal.stdin, "\t");
    await waitForNextImmediate();
    await sendInput(terminal.stdin, "\r");
    await waitForOutput(terminal.stdout, () => output, "Open browser sign-in?");
    assert.doesNotMatch(output, /Choose OAuth target/);
    assert.match(output, /Target: preprod/);
    await waitForNextImmediate();
    await sendInput(terminal.stdin, "\r");
    await waitForOutput(terminal.stdout, () => output, "✓ Sign-in successful");
    const loginRequest = await loginRequestPromise;
    assert.match(output, /http:\/\/127\.0\.0\.1:53683\/oauth\/callback/);
    assert.equal(loginRequest.port, 53683);
    assert.equal(loginRequest.timeoutMs, 180000);
    assert.equal(loginRequest.clientId, "flag-client");
    assert.equal(
      loginRequest.authBaseUrl,
      "https://api.preprod.sokosumi.com/auth",
    );
    await sendInput(terminal.stdin, "q");

    await cliPromise;
  } finally {
    instance?.unmount();
    await cliPromise;
    instance?.cleanup();
  }
});

test("hosted TUI selection preserves an explicit client ID", () => {
  const config = resolveHostedTargetConfig(
    {
      SOKOSUMI_API_URL: "https://api.preprod.sokosumi.com",
      SOKOSUMI_MAINNET_OAUTH_CLIENT_ID: "target-client",
    },
    "mainnet",
    { clientId: "flag-client" },
  );

  assert.equal(config.clientId, "flag-client");
});
