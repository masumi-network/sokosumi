import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";

import { type Instance, render as inkRender } from "ink";
import {
  type InkPromptRenderer,
  promptForUpdateWithInk,
} from "../../src/tui/update-prompt.js";

type TestStdin = PassThrough & NodeJS.ReadStream;
type TestStdout = PassThrough & NodeJS.WriteStream;

function createTerminal(): { stdin: TestStdin; stdout: TestStdout } {
  const stdin = new PassThrough() as TestStdin;
  const stdout = new PassThrough() as TestStdout;
  Object.assign(stdin, {
    isRaw: false,
    isTTY: true,
    ref: () => stdin,
    setRawMode: (_mode: boolean) => stdin,
    unref: () => stdin,
  });
  Object.assign(stdout, { isTTY: true, columns: 80, rows: 24 });
  return { stdin, stdout };
}

const render: InkPromptRenderer = (node, options) =>
  inkRender(node, { ...options, debug: true }) as Instance;

async function sendInput(stdin: TestStdin, input: string): Promise<void> {
  stdin.write(input);
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  await promise;
}

async function promptWithInput(
  inputs: readonly string[],
  message = "Update Sokosumi? [y/N]",
): Promise<{ answer: string; output: string }> {
  const { stdin, stdout } = createTerminal();
  let output = "";
  stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  const result = promptForUpdateWithInk(message, {
    render,
    stdin,
    stdout,
  });
  for (const input of inputs) await sendInput(stdin, input);
  return { answer: await result, output };
}

test("Ink update prompt renders the dynamic update message", async () => {
  const prompt = await promptWithInput(
    ["y"],
    "Sokosumi update available: v2.1.3 → v2.1.4",
  );
  assert.equal(prompt.answer, "y");
  assert.match(prompt.output, /v2\.1\.3.*v2\.1\.4/);
});

test("Ink update prompt accepts y", async () => {
  assert.equal((await promptWithInput(["y"])).answer, "y");
});
test("Ink update prompt accepts pasted yes", async () => {
  assert.equal((await promptWithInput(["yes"])).answer, "y");
});

test("Ink update prompt declines with n", async () => {
  assert.equal((await promptWithInput(["n"])).answer, "n");
});

test("Ink update prompt cancels with Escape", async () => {
  assert.equal((await promptWithInput(["\u001b"])).answer, "n");
});
test("Ink update prompt cancels with Ctrl+C", async () => {
  assert.equal((await promptWithInput(["\u0003"])).answer, "n");
});
