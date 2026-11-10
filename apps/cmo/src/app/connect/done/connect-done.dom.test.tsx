// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ConnectDone } from "./connect-done";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("BroadcastChannel", undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  Object.defineProperty(window, "opener", { configurable: true, value: null });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("tells the onboarding it is done on its own origin, then closes", async () => {
  const postMessage = vi.fn();
  Object.defineProperty(window, "opener", {
    configurable: true,
    value: { postMessage },
  });
  const close = vi.spyOn(window, "close").mockImplementation(() => {});

  await act(async () => root.render(<ConnectDone result="connected" />));

  expect(postMessage).toHaveBeenCalledWith(
    { type: "cmo-connect-done", result: "connected" },
    window.location.origin,
  );
  expect(close).toHaveBeenCalledTimes(1);
});

it("left open without an opener, links back to Launch", async () => {
  vi.spyOn(window, "close").mockImplementation(() => {});

  await act(async () => root.render(<ConnectDone result="failed" />));

  expect(host.textContent).toContain("That connection didn't finish.");
  expect(host.querySelector("a")?.getAttribute("href")).toBe(
    "/?step=connect&from=onboarding&connect=failed",
  );
});
