import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { render as inkRender } from "ink";
import React from "react";

import {
  moveSelectionIndex,
  SelectInput,
  type SelectItem,
} from "../../src/tui/select-input.js";

test("selector moves down and wraps at the end", () => {
  assert.equal(moveSelectionIndex(0, 1, 2), 1);
  assert.equal(moveSelectionIndex(1, 1, 2), 0);
});

test("selector moves up and wraps at the beginning", () => {
  assert.equal(moveSelectionIndex(1, -1, 2), 0);
  assert.equal(moveSelectionIndex(0, -1, 2), 1);
});

test("selector stays at zero when it has no items", () => {
  assert.equal(moveSelectionIndex(4, 1, 0), 0);
});

test("TestV45 q does not select a row; arrows plus Enter remain the only selector action", async () => {
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

  let selected: string | undefined;
  const items: readonly SelectItem<string>[] = [
    { value: "one", label: "One" },
    { value: "two", label: "Two" },
  ];
  const instance = inkRender(
    React.createElement(SelectInput, {
      items,
      onSelect: (value: unknown) => {
        if (typeof value === "string") selected = value;
      },
    }),
    {
      debug: true,
      stdin,
      stdout,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );

  const send = async (input: string): Promise<void> => {
    stdin.write(input);
    stdin.emit("readable");
    await new Promise<void>((resolve) => setImmediate(resolve));
  };

  try {
    await send("q");
    assert.equal(selected, undefined);
    await send("a");
    assert.equal(selected, undefined);
    await send("\u001b[B");
    await send("\r");
    assert.equal(selected, "two");
  } finally {
    instance.unmount();
    instance.cleanup();
  }
});
