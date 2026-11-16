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

async function ask(subscribed: boolean): Promise<string> {
  await act(async () => {
    root.render(
      <StartOver
        className="button"
        startOver={vi.fn()}
        subscribed={subscribed}
      />,
    );
  });
  await act(async () => {
    host.querySelector<HTMLButtonElement>("button")?.click();
  });
  return host.querySelector("form")?.textContent ?? "";
}

describe("StartOver", () => {
  it("tells the owner of a subscribed Cuso that the subscription ends now, without a refund, and his credits are removed", async () => {
    const text = await ask(true);

    expect(text).toContain(
      "His subscription ends now without a refund, and his credits are removed.",
    );
    expect(text).toContain("Cuso stops and his unsent posts are canceled.");
  });

  it("says nothing about a subscription for a Cuso without one", async () => {
    const text = await ask(false);

    expect(text).toContain("Cuso stops and his unsent posts are canceled.");
    expect(text).not.toContain("subscription");
    expect(text).not.toContain("refund");
  });

  it("shows the loading bar on a menu-item Start over while it runs", async () => {
    const startOver = vi.fn(() => new Promise<string | null>(() => {}));
    await act(async () => {
      root.render(
        <StartOver
          className="ob-who-item"
          startOver={startOver}
          subscribed={false}
        />,
      );
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
