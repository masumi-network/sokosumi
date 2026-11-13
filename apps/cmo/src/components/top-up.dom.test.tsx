// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LearningCard } from "./app/cards";
import { type StartTopUp, TopUpButton } from "./top-up";

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

async function press(label: string) {
  const button = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!button) throw new Error(`No "${label}" button`);
  await act(async () => button.click());
}

describe("TopUpButton", () => {
  it("sends the browser to the checkout", async () => {
    const assign = vi
      .spyOn(window.location, "assign")
      .mockImplementation(() => {});
    const startTopUp = vi.fn<StartTopUp>(async () => ({
      url: "https://polar.example/checkout/1",
      error: null,
    }));
    await act(async () => root.render(<TopUpButton startTopUp={startTopUp} />));

    await press("Top up");

    expect(startTopUp).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith("https://polar.example/checkout/1");
  });

  it("says why the checkout did not open", async () => {
    const assign = vi
      .spyOn(window.location, "assign")
      .mockImplementation(() => {});
    await act(async () =>
      root.render(
        <TopUpButton
          startTopUp={async () => ({
            url: null,
            error: "A top-up needs an active CMO subscription",
          })}
        />,
      ),
    );

    await press("Top up");

    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "A top-up needs an active CMO subscription",
    );
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("LearningCard after a retry refused for credits", () => {
  const actions = (topUp: StartTopUp | null) => ({
    approve: async () => {},
    revert: async () => {},
    retryLearning: async () => "You're out of credits",
    compose: () => {},
    open: () => {},
    topUp,
  });

  it("offers the top-up", async () => {
    await act(async () =>
      root.render(
        <LearningCard
          brain={null}
          state="failed"
          actions={actions(async () => ({ url: null, error: null }))}
        />,
      ),
    );

    await press("Try again");

    expect(host.textContent).toContain("You're out of credits.");
    expect(
      [...host.querySelectorAll("button")].map((button) => button.textContent),
    ).toContain("Top up");
  });

  it("offers none for an unsubscribed Cuso", async () => {
    await act(async () =>
      root.render(
        <LearningCard brain={null} state="failed" actions={actions(null)} />,
      ),
    );

    await press("Try again");

    expect(host.textContent).toContain("You're out of credits.");
    expect(host.textContent).not.toMatch(/top up/i);
  });
});
