import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";

import { render as inkRender } from "ink";
import React from "react";

import type { CoreHttpClient } from "../../src/api/http-client.js";
import { ResourceView } from "../../src/tui/resource-view.js";

test("Account screen is static auth method and target without Core fetch", async () => {
  type TestStdin = PassThrough & NodeJS.ReadStream;
  type TestStdout = PassThrough & NodeJS.WriteStream;
  const stdin = new PassThrough() as TestStdin;
  const stdout = new PassThrough() as TestStdout;
  Object.assign(stdin, {
    isRaw: false,
    isTTY: true,
    ref: () => stdin,
    setRawMode: (_mode: boolean) => stdin,
    unref: () => stdin,
  });
  Object.assign(stdout, { columns: 80, isTTY: true, rows: 24 });

  let output = "";
  stdout.on("data", (chunk) => {
    output += String(chunk);
  });

  const client: CoreHttpClient = {
    get: async () => {
      throw new Error("Account must not fetch Core");
    },
    post: async () => {
      throw new Error("Account must not fetch Core");
    },
    patch: async () => {
      throw new Error("Account must not fetch Core");
    },
    delete: async () => {
      throw new Error("Account must not fetch Core");
    },
  };

  const instance = inkRender(
    React.createElement(ResourceView, {
      resource: "account",
      coreClient: client,
      onBack: () => {},
      accountAuthMethod: "oauth",
      accountTarget: "mainnet",
    }),
    {
      debug: true,
      stdin,
      stdout,
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    },
  );

  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.match(output, /Signed in/);
    assert.match(output, /Auth method: browser OAuth/);
    assert.match(output, /Target: mainnet/);
    assert.doesNotMatch(output, /Loading|Error:/);
  } finally {
    instance.unmount();
    instance.cleanup();
  }
});
