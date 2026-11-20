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

it("opens on Today: the greeting, the month, the week, then what needs the owner", async () => {
  await act(async () => root.render(<FixtureApp view="today" />));
  expect(container.querySelector("h1")?.textContent).toBe(
    "Good morning, Francis.",
  );
  const sections = [...container.querySelectorAll(".today h2")].map(
    (head) => head.textContent,
  );
  // Needs you comes last, where the sidebar's Cuso points.
  expect(sections).toEqual(["This month", "This week", "Needs you"]);
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
  // The chat has its own tab; Today asks nothing of its own.
  expect(container.textContent).not.toContain("Ask Cuso anything");
});

it("keeps a full week short: per network counts, three posts a day, the rest on tap", async () => {
  await act(async () => root.render(<FixtureApp view="today" state="busy" />));
  const wednesday = [...container.querySelectorAll(".week-day")][2];
  if (!wednesday) throw new Error("no Wednesday");
  // Six posts on Wednesday 11: X twice, the other four networks once.
  expect(
    [...wednesday.querySelectorAll(".week-net")].map((chip) =>
      chip.getAttribute("aria-label"),
    ),
  ).toEqual([
    "X: 2",
    "LinkedIn: 1",
    "Instagram: 1",
    "Facebook: 1",
    "YouTube: 1",
  ]);
  expect(wednesday.querySelectorAll(".week-post")).toHaveLength(3);
  const more = wednesday.querySelector<HTMLButtonElement>(".week-more");
  expect(more?.textContent).toBe("+3 more");
  // Every day shows at most three.
  for (const day of container.querySelectorAll(".week-day")) {
    expect(day.querySelectorAll(".week-post").length).toBeLessThanOrEqual(3);
  }

  await act(async () => more?.click());
  expect(wednesday.querySelectorAll(".week-post")).toHaveLength(6);
  expect(wednesday.querySelector(".week-more")).toBeNull();
  expect(
    wednesday.querySelector(".week-date")?.getAttribute("aria-expanded"),
  ).toBe("true");
  // The phone shows the day picked, today until then.
  expect(wednesday.hasAttribute("data-shown")).toBe(true);
  expect(
    container.querySelector(".week-today")?.hasAttribute("data-shown"),
  ).toBe(false);
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

it("keeps a week without posts short and says nothing needs the owner", async () => {
  await act(async () => root.render(<FixtureApp view="today" state="quiet" />));
  expect(container.querySelector(".today-week-empty")).not.toBeNull();
  expect(container.querySelector(".today-week")).toBeNull();
  expect(container.querySelector(".today-needs")).toBeNull();
});
