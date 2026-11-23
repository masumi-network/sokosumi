// @vitest-environment happy-dom

import type { CmoOverview } from "@sokosumi/core-client";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { cmoOverview } from "../../test-fixtures/cmo";
import { WriteNewStrategy } from "./write-new-strategy";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(
  overview: CmoOverview,
  onWriteNew: () => Promise<string | null>,
) {
  act(() =>
    root.render(
      <WriteNewStrategy overview={overview} onWriteNew={onWriteNew} />,
    ),
  );
}

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (element) => element.textContent === label,
  );
}

it("asks for a whole new strategy only after the owner confirms", async () => {
  const onWriteNew = vi.fn(async () => null);
  render(cmoOverview(), onWriteNew);

  act(() => button("Write a new strategy")?.click());
  expect(onWriteNew).not.toHaveBeenCalled();
  expect(container.textContent).toContain("keeps running until you approve");

  await act(async () => button("Write it")?.click());
  expect(onWriteNew).toHaveBeenCalledOnce();
  expect(button("Write a new strategy")).toBeDefined();
});

it("keeps the confirmation open with Core's refusal", async () => {
  render(cmoOverview(), async () => "Cuso is still writing the strategy");

  act(() => button("Write a new strategy")?.click());
  await act(async () => button("Write it")?.click());

  expect(container.querySelector("[role=alert]")?.textContent).toBe(
    "Cuso is still writing the strategy",
  );
  expect(button("Write it")).toBeDefined();
});

it("is not offered to a member who cannot approve", () => {
  render(cmoOverview({ viewerCanApprove: false }), async () => null);
  expect(container.textContent).toBe("");
});

it("says a strategy is being written instead of offering another", () => {
  const overview = cmoOverview();
  render(
    {
      ...overview,
      work: { ...overview.work, kind: "strategy", status: "running" },
    } as CmoOverview,
    async () => null,
  );
  expect(button("Write a new strategy")).toBeUndefined();
  expect(container.textContent).toContain("is writing a strategy");
});
