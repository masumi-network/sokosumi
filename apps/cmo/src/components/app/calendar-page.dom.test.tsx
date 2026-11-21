// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { overview } from "../../app/design-system/app/fixtures";
import { CalendarPage } from "./calendar-page";
import type { DraftActions } from "./draft-post";

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

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const text = () => container.textContent ?? "";
const press = (label: string, within: ParentNode = container) =>
  act(async () => {
    const found = [...within.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(label),
    );
    if (!found) throw new Error(`No button "${label}"`);
    found.click();
  });

function drafts(): DraftActions {
  return {
    approve: vi.fn(async () => null),
    decline: vi.fn(async () => null),
    edit: vi.fn(async () => null),
    tikTokCreator: async () => ({ creator: null, error: null }),
  };
}

async function render(actions: DraftActions, onConnect = vi.fn()) {
  await act(async () =>
    root.render(
      <CalendarPage
        overview={overview}
        drafts={actions}
        onAsk={async () => {}}
        onConnect={onConnect}
      />,
    ),
  );
  return onConnect;
}

it("says a written post waits for its network, with the way to connect it", async () => {
  const onConnect = await render(drafts());
  // Facebook is not connected in the fixture; its post is written.
  const card = [...container.querySelectorAll("button.cal-card")].find(
    (button) => button.textContent?.includes("Meet the crew"),
  );
  expect(card?.textContent).toContain("Waiting for Facebook");
  expect(card?.textContent).not.toContain("Written");
  // One line for every network posts wait for, and one way to Channels.
  expect(container.querySelectorAll(".cal-waits")).toHaveLength(1);
  expect(text()).toContain("1 post waits for Facebook.");
  await press("Connect");
  expect(onConnect).toHaveBeenCalled();
});

it("opens a post as it looks on its network and saves the owner's own words through Core", async () => {
  const actions = drafts();
  await render(actions);
  await press("Inside the test stand");
  const post = container.querySelector(".sheet .post");
  expect(post?.textContent).toContain("Acme");
  expect(post?.textContent).toContain("@acme");
  expect(post?.querySelector("img.post-media")).not.toBeNull();
  expect(container.querySelector(".sheet")?.textContent).toContain("Scheduled");

  await press("Edit text");
  const box = container.querySelector<HTMLTextAreaElement>(".sheet textarea");
  if (!box) throw new Error("No text box");
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set?.call(box, "Inside the test stand, in one minute.");
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await press("Save");
  expect(actions.edit).toHaveBeenCalledWith(
    "e6-linkedin",
    1,
    "Inside the test stand, in one minute.",
  );
  expect(container.querySelector(".sheet textarea")).toBeNull();
});

it("offers no edit on a post that is already out", async () => {
  await render(drafts());
  await press("Launch day countdown");
  expect(container.querySelector(".sheet .post")).not.toBeNull();
  expect(container.querySelector(".sheet")?.textContent).not.toContain(
    "Edit text",
  );
});

it("says a post didn't go out, and why when it is open", async () => {
  const calendar = (overview.strategy?.calendar ?? []).map((entry) =>
    entry.title === "What a slipped launch costs"
      ? { ...entry, notSent: "X refused it." }
      : entry,
  );
  const strategy = overview.strategy
    ? { ...overview.strategy, calendar }
    : null;
  await act(async () =>
    root.render(
      <CalendarPage
        overview={{ ...overview, strategy, approvedStrategy: strategy }}
        drafts={drafts()}
        onAsk={async () => {}}
      />,
    ),
  );
  const card = [...container.querySelectorAll("button.cal-card")].find(
    (button) => button.textContent?.includes("What a slipped launch costs"),
  );
  expect(card?.textContent).toContain("Didn't go out");
  expect(card?.textContent).not.toContain("Written");
  await press("What a slipped launch costs");
  expect(container.querySelector(".sheet")?.textContent).toContain(
    "Didn't go out. X refused it.",
  );
});

it("marks this week and what goes out today, and tints a post's words with its network", async () => {
  Element.prototype.scrollIntoView = vi.fn();
  await act(async () =>
    root.render(
      <CalendarPage
        overview={overview}
        drafts={drafts()}
        onAsk={async () => {}}
        // Wednesday 11 November, mid-morning in Berlin.
        now={new Date("2026-11-11T09:00:00Z")}
      />,
    ),
  );
  const weeks = [...container.querySelectorAll(".cal-week-head")].map(
    (head) => head.textContent,
  );
  expect(weeks.filter((head) => head?.startsWith("This week"))).toEqual([
    "This weekWeek 29 Nov",
  ]);
  // The page opens on this week, not on the weeks already gone out.
  expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
    block: "start",
  });
  const slipped = [...container.querySelectorAll("button.cal-card")].find(
    (card) => card.textContent?.includes("What a slipped launch costs"),
  );
  expect(slipped?.querySelector(".cal-when-today")?.textContent).toBe(
    "Today 09:00",
  );
  expect(slipped?.querySelector(".cal-words")?.classList).toContain("net-x");
});
