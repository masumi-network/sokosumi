// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StartOver } from "./start-over";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("StartOver", () => {
  it("shows the loading bar on a menu-item Start over while it runs", async () => {
    const startOver = vi.fn(() => new Promise<string | null>(() => {}));
    await act(async () => {
      root.render(<StartOver className="ob-who-item" startOver={startOver} />);
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>("button")?.click();
    });
    const submit = host.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    expect(submit?.className).toBe("ob-who-item");
    await act(async () => submit?.click());

    expect(submit?.getAttribute("aria-busy")).toBe("true");
    expect(submit?.querySelector(".button-loading-bar")).not.toBeNull();
    expect(startOver).toHaveBeenCalledOnce();
  });
});
