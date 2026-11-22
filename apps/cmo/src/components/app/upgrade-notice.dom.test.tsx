// @vitest-environment happy-dom

import type { CmoOverview } from "@sokosumi/core-client";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fixtureActions } from "../../app/design-system/app/fixture-app";
import { cmoOverview } from "../../test-fixtures/cmo";
import { CmoApp } from "./cmo-app";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const upgraded = (): CmoOverview => ({
  ...cmoOverview(),
  upgrade: {
    versionId: "cmo-v15",
    lines: ["Your strategy and Cuso's messages now use plain words."],
  },
});

function render(
  overview: CmoOverview,
  markUpgradeSeen = vi.fn(async () => {}),
) {
  act(() =>
    root.render(
      <CmoApp
        overview={overview}
        messages={[]}
        name="Ada"
        email="ada@example.com"
        actions={{ ...fixtureActions, markUpgradeSeen }}
      />,
    ),
  );
  return markUpgradeSeen;
}

const dialog = () => host.querySelector(".upgrade-notice");

it("tells the owner once what Cuso's newer version changed", () => {
  const markUpgradeSeen = render(upgraded());
  expect(dialog()?.getAttribute("role")).toBe("dialog");
  expect(dialog()?.textContent).toContain("Cuso just got better");
  expect(dialog()?.textContent).toContain("plain words");

  const gotIt = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Got it",
  );
  act(() => gotIt?.click());
  expect(dialog()).toBeNull();
  expect(markUpgradeSeen).toHaveBeenCalledWith("cmo-v15");
});

it("closes on Escape too", () => {
  const markUpgradeSeen = render(upgraded());
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  expect(dialog()).toBeNull();
  expect(markUpgradeSeen).toHaveBeenCalledOnce();
});

it("shows nothing without a move", () => {
  render(cmoOverview());
  expect(dialog()).toBeNull();
});
