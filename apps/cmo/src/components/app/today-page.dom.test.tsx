// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { FixtureApp } from "../../app/design-system/app/fixture-app";
import { overview } from "../../app/design-system/app/fixtures";

// The Calendar's sheet has nothing to animate in a test DOM.
vi.mock("motion/react", () => {
  const plain =
    (Tag: "div" | "aside") =>
    ({
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...rest
    }: Record<string, unknown>) => <Tag {...rest} />;
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: { div: plain("div"), aside: plain("aside") },
  };
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // A Monday in the fixture month, mid-morning in Berlin.
  vi.setSystemTime(new Date("2026-11-09T08:00:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("opens on Today: what needs the owner, the week with today marked, and the chat a tap away", async () => {
  await act(async () => root.render(<FixtureApp view="today" />));
  expect(container.querySelector("h1")?.textContent).toBe(
    "Good morning, Francis",
  );
  const needs = [...container.querySelectorAll(".needs-row b")].map(
    (row) => row.textContent,
  );
  const waiting = overview.drafts.filter(
    (draft) => draft.status === "NEEDS_APPROVAL",
  ).length;
  expect(needs).toContain(
    waiting === 1
      ? "1 post waits for your OK"
      : `${waiting} posts wait for your OK`,
  );
  expect(container.querySelector(".nav a.active")?.textContent).toBe(
    `Today${needs.length}`,
  );
  // One primary action on the page.
  expect(
    container.querySelectorAll(
      ".today .button:not(.button-secondary):not(.button-ghost)",
    ),
  ).toHaveLength(1);
  const today = container.querySelector(".week-today");
  expect(today?.textContent).toContain("9");
  expect(today?.textContent).toContain("Today");

  await act(async () => {
    container.querySelector<HTMLButtonElement>(".today-ask")?.click();
  });
  expect(container.querySelector(".nav a.active")?.textContent).toBe("Cuso");
  expect(document.activeElement?.tagName).toBe("TEXTAREA");
});

it("opens a post of the week on the Calendar in one tap", async () => {
  await act(async () => root.render(<FixtureApp view="today" />));
  const post = container.querySelector<HTMLButtonElement>(
    ".week-today .week-post",
  );
  expect(post).not.toBeNull();
  await act(async () => post?.click());
  expect(container.querySelector(".nav a.active")?.textContent).toBe(
    "Calendar",
  );
  expect(container.querySelector("[role=dialog]")).not.toBeNull();
});
