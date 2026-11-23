// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fixtureActions } from "../../app/design-system/app/fixture-app";
import { cmoOverview, cmoStrategy } from "../../test-fixtures/cmo";
import { CmoApp } from "./cmo-app";

// The sheet's entrance has nothing to animate in a test DOM.
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

const sheet = () => host.querySelector(".sheet");
const navTo = (label: string) =>
  act(() => {
    const link = [...host.querySelectorAll("nav.side button, nav.side a")].find(
      (item) => item.textContent?.trim().startsWith(label),
    ) as HTMLElement | undefined;
    if (!link) throw new Error(`No nav item "${label}"`);
    link.click();
  });

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

// A post on each of the days around now, so this week shows one whatever the zone.
const withThisWeek = () => {
  const strategy = {
    ...cmoStrategy,
    calendar: [-1, 0, 1].map((offset) => ({
      ...cmoStrategy.calendar[0],
      id: `p${offset}`,
      date: day(offset),
      status: "scheduled" as const,
    })),
  };
  return { ...cmoOverview(), strategy, approvedStrategy: strategy };
};

it("opens a post picked on Today once, and the Calendar with nothing open after that", () => {
  act(() =>
    root.render(
      <CmoApp
        overview={withThisWeek()}
        messages={[]}
        name="Ada"
        email="ada@example.com"
        actions={fixtureActions}
      />,
    ),
  );
  const post = host.querySelector<HTMLButtonElement>(".week-post");
  expect(post).not.toBeNull();
  act(() => post?.click());
  expect(sheet()).not.toBeNull();

  navTo("Today");
  navTo("Calendar");
  expect(sheet()).toBeNull();
});
