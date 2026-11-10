// @vitest-environment happy-dom

import { afterEach, expect, it, vi } from "vitest";

import {
  connectDonePath,
  listenForConnectDone,
  readConnectResult,
  tellOpener,
} from "./connect-window";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const done = (result: string, origin = window.location.origin) =>
  window.dispatchEvent(
    new MessageEvent("message", {
      origin,
      data: { type: "cmo-connect-done", result },
    }),
  );

it("names the page a connect window ends on", () => {
  expect(connectDonePath("connected")).toBe("/connect/done?result=connected");
});

it("reads only the results it knows, anything else as failed", () => {
  expect(readConnectResult("connected")).toBe("connected");
  expect(readConnectResult("none")).toBe("none");
  expect(readConnectResult("failed")).toBe("failed");
  expect(readConnectResult(null)).toBe("failed");
  expect(readConnectResult("constructor")).toBe("failed");
});

it("hears a connect window of its own origin", () => {
  const onDone = vi.fn();
  const stop = listenForConnectDone(onDone);

  done("connected");
  expect(onDone).toHaveBeenCalledWith("connected");

  stop();
  done("connected");
  expect(onDone).toHaveBeenCalledTimes(1);
});

it("ignores another origin and messages of another shape", () => {
  const onDone = vi.fn();
  const stop = listenForConnectDone(onDone);

  done("connected", "https://evil.example");
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: window.location.origin,
      data: { type: "something-else", result: "connected" },
    }),
  );
  done("whatever");

  expect(onDone).not.toHaveBeenCalled();
  stop();
});

it("tells the opener only on its own origin", () => {
  const postMessage = vi.fn();
  vi.stubGlobal("BroadcastChannel", undefined);
  Object.defineProperty(window, "opener", {
    configurable: true,
    value: { postMessage },
  });

  expect(tellOpener("connected")).toBe(true);
  expect(postMessage).toHaveBeenCalledWith(
    { type: "cmo-connect-done", result: "connected" },
    window.location.origin,
  );
  Object.defineProperty(window, "opener", { configurable: true, value: null });
});

// A provider's sign-in can cut the popup from its opener
// (Cross-Origin-Opener-Policy); a same-origin channel still reaches it.
it("also tells CMO's own pages on a same-origin channel", () => {
  const channels: {
    name: string;
    onmessage: ((e: MessageEvent) => void) | null;
  }[] = [];
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      onmessage: ((event: MessageEvent) => void) | null = null;
      constructor(readonly name: string) {
        channels.push(this);
      }
      postMessage(data: unknown) {
        for (const channel of channels) {
          if (channel !== this && channel.name === this.name) {
            channel.onmessage?.(new MessageEvent("message", { data }));
          }
        }
      }
      close() {}
    },
  );
  Object.defineProperty(window, "opener", { configurable: true, value: null });
  const onDone = vi.fn();
  const stop = listenForConnectDone(onDone);

  expect(tellOpener("none")).toBe(false);

  expect(onDone).toHaveBeenCalledWith("none");
  stop();
});
