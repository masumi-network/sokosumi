import assert from "node:assert/strict";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { type Instance, render as inkRender } from "ink";
import {
  AuthManager,
  type OAuthCredentials,
} from "../../src/auth/auth-manager.js";
import type { BrowserLoginOptions } from "../../src/auth/oauth.js";
import { runCli } from "../../src/cli/index.js";
import {
  renderStatusApp,
  resolveHostedTargetConfig,
  type StatusAppOptions,
} from "../../src/tui/status-app.js";

test("TestV32 mainnet TUI selection overrides a preprod API URL", () => {
  const config = resolveHostedTargetConfig(
    { SOKOSUMI_API_URL: "https://api.preprod.sokosumi.com" },
    "mainnet",
  );

  assert.equal(config.target, "mainnet");
  assert.equal(config.apiUrl, "https://api.sokosumi.com");
  assert.equal(config.authBaseUrl, "https://api.sokosumi.com/auth");
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
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  await promise;
}
async function sendInput(stdin: PassThrough, input: string): Promise<void> {
  stdin.write(input);
  stdin.emit("readable");
  await waitForNextImmediate();
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

test("TestV34 runCli TUI selection preserves explicit client ID", async () => {
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
    });
    instance = nextInstance;
    return nextInstance;
  };

  const loginRequestResolvers = Promise.withResolvers<BrowserLoginOptions>();
  const loginRequestPromise = loginRequestResolvers.promise;
  const cliPromise = runCli(["--client-id", "flag-client"], {
    env: {
      SOKOSUMI_API_URL: "https://api.sokosumi.com",
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
  });

  try {
    await waitForOutput(terminal.stdout, () => output, "Browser OAuth");
    await waitForNextImmediate();
    await sendInput(terminal.stdin, "\r");
    await waitForOutput(terminal.stdout, () => output, "Choose OAuth target");

    await sendInput(terminal.stdin, "\u001b[B");
    await waitForOutput(terminal.stdout, () => output, "› Preprod");
    await sendInput(terminal.stdin, "\r");
    await waitForOutput(terminal.stdout, () => output, "Open browser sign-in?");
    assert.match(output, /Target: preprod/);
    await waitForNextImmediate();
    await sendInput(terminal.stdin, "\r");

    const loginRequest = await loginRequestPromise;
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

test("TestV34 hosted TUI selection preserves an explicit client ID", () => {
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
