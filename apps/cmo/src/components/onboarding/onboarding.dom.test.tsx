// @vitest-environment happy-dom

import { MotionGlobalConfig } from "motion/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { cmoOverview } from "../../test-fixtures/cmo";
import {
  brain,
  draft,
  mappedBrain,
  sevenPlan,
  strategy,
} from "../../test-fixtures/onboarding";
import { Onboarding } from "../onboarding";
import { LAND_MS } from "../type-in";
import { BrandStep } from "./brand-step";
import { PlanReview } from "./plan-step";

// happy-dom cannot run Web Animations; motion's would reject on unmount.
MotionGlobalConfig.skipAnimations = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.scrollTo = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((element) =>
    element.textContent?.startsWith(text),
  );
  if (!found) throw new Error(`No button "${text}"`);
  return found;
}

const press = (text: string) => act(async () => button(text).click());
const text = () => container.textContent ?? "";

function typeInto(input: HTMLInputElement | null, value: string) {
  if (!input) throw new Error("No input");
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const noop = async () => {};

async function renderPlan() {
  await act(async () =>
    root.render(
      <PlanReview
        overview={cmoOverview({
          onboardingStep: "strategy",
          strategy: {
            ...strategy,
            pace: { level: "active", why: "One a day", perWeek: 7 },
          },
        })}
        onConnectMeasurement={async () => ({ url: null, error: null })}
      />,
    ),
  );
}

it("opens the Cuso picker from the hire form account menu", async () => {
  await act(async () =>
    root.render(
      <Onboarding
        signOut={noop}
        cusoPicker
        onboard={async (previous) => previous}
      />,
    ),
  );

  await press("Account");

  expect(container.querySelector('a[href="/?cusos=1"]')?.textContent).toBe(
    "Your Cusos",
  );
});

it("leaves the Cuso picker out of the hire form account menu without a Cuso", async () => {
  await act(async () =>
    root.render(
      <Onboarding
        signOut={noop}
        onboard={async (previous) => previous}
        cusoPicker={false}
      />,
    ),
  );

  await press("Account");

  expect(container.querySelector('a[href="/?cusos=1"]')).toBeNull();
});

it("opens a tile into the side panel with a way to say what is off", async () => {
  const sent = vi.fn(async () => {});
  await act(async () =>
    root.render(
      <BrandStep
        overview={draft({ brandBrainConfirmedAt: null, strategy: null })}
        messages={[]}
        onCorrect={sent}
        onSave={noop}
      />,
    ),
  );
  expect(container.querySelector("aside")).toBeNull();
  // The whole tile is the button.
  const tile = [
    ...container.querySelectorAll<HTMLButtonElement>("button.ob-tile"),
  ].find((candidate) => candidate.textContent?.startsWith("What you sell"));
  expect(tile?.getAttribute("aria-expanded")).toBe("false");
  await act(async () => tile?.click());
  expect(tile?.getAttribute("aria-expanded")).toBe("true");
  const panel = container.querySelector("aside");
  expect(panel?.getAttribute("aria-label")).toBe("What you sell");
  expect(panel?.textContent).toContain("Rocket Pro");
  // One labelled field, not a bare placeholder.
  expect(panel?.querySelector('label[for="ob-tell"]')?.textContent).toBe(
    "Tell Cuso what's off",
  );
  expect(panel?.querySelectorAll("form")).toHaveLength(1);
  typeInto(
    panel?.querySelector<HTMLInputElement>("#ob-tell") ?? null,
    "Rocket Pro costs $149",
  );
  await act(async () =>
    [...(panel?.querySelectorAll("button") ?? [])]
      .find((candidate) => candidate.textContent === "Send")
      ?.click(),
  );
  expect(sent).toHaveBeenCalledWith("Rocket Pro costs $149");
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Close"]')?.click(),
  );
  expect(container.querySelector("aside")).toBeNull();
});

it("resets the section editor when switching brand tiles", async () => {
  const section = (answer: string) => ({
    answer,
    findings: [
      { point: answer, evidence: "fact" as const, confidence: "high" as const },
    ],
  });
  await act(async () =>
    root.render(
      <BrandStep
        overview={draft({
          brandBrainConfirmedAt: null,
          strategy: null,
          brandBrain: {
            ...brain,
            profile: {
              offer: section("Rockets for founders"),
              customers: section("Founders buy them"),
            },
          },
        })}
        messages={[]}
        onCorrect={noop}
        onSave={noop}
      />,
    ),
  );
  const tileNamed = (label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("button.ob-tile")].find(
      (candidate) => candidate.textContent?.startsWith(label),
    );
  const editInPanel = () =>
    [...container.querySelectorAll<HTMLButtonElement>("aside button")].find(
      (candidate) => candidate.textContent === "Edit",
    );
  const editor = () => container.querySelector("aside form.bp-editor");

  await act(async () => tileNamed("What you sell")?.click());
  expect(container.querySelector("aside")?.getAttribute("aria-label")).toBe(
    "What you sell",
  );
  expect(container.querySelector("aside")?.textContent).toContain(
    "Rockets for founders",
  );
  await act(async () => editInPanel()?.click());
  expect(editor()).not.toBeNull();
  const headline = editor()?.querySelector("input");
  expect(headline).not.toBeNull();
  typeInto(headline ?? null, "Wrong headline for sell");
  expect(headline?.value).toBe("Wrong headline for sell");
  // Open another editable tile without closing: the editor must remount.
  await act(async () => tileNamed("Who buys")?.click());
  expect(container.querySelector("aside")?.getAttribute("aria-label")).toBe(
    "Who buys",
  );
  expect(container.querySelector("aside")?.textContent).toContain(
    "Founders buy them",
  );
  expect(editor()).toBeNull();
  await act(async () => editInPanel()?.click());
  expect(editor()?.querySelector("input")?.value).toBe("");
});

it("sends a tile's fix to its section, not to the chat", async () => {
  const onFix = vi.fn(async () => {});
  const onCorrect = vi.fn(async () => {});
  await act(async () =>
    root.render(
      <BrandStep
        overview={draft({ brandBrainConfirmedAt: null })}
        messages={[]}
        onCorrect={onCorrect}
        onFix={onFix}
        onSave={noop}
      />,
    ),
  );
  await press("What you sell");
  typeInto(
    container.querySelector<HTMLInputElement>("#ob-tell"),
    "From 19 dollars a month.",
  );
  await press("Send");
  expect(onFix).toHaveBeenCalledWith("offer", "From 19 dollars a month.");
  expect(onCorrect).not.toHaveBeenCalled();
});

it("opens the tab the founder picks, and keeps Results one tap away", async () => {
  await renderPlan();
  expect(
    container.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
  ).toBe("Three moves");
  await act(async () =>
    [...container.querySelectorAll<HTMLElement>('[role="tab"]')]
      .find((tab) => tab.textContent === "How we know it works")
      ?.click(),
  );
  expect(text()).toContain("Connect your numbers");
  await act(async () =>
    [...container.querySelectorAll<HTMLElement>('[role="tab"]')]
      .find((tab) => tab.textContent === "Your month")
      ?.click(),
  );
  expect(text()).toContain("Up first");
});

it("moves between plan tabs with the arrow keys", async () => {
  await renderPlan();
  const selected = () =>
    container.querySelector('[role="tab"][aria-selected="true"]');
  const active = selected();
  expect(active?.textContent).toBe("Three moves");
  await act(async () => {
    active?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
  });
  expect(selected()?.textContent).toBe("Your month");
  expect(text()).toContain("Up first");
  await act(async () => {
    selected()?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true }),
    );
  });
  expect(selected()?.textContent).toBe("How we know it works");
  expect(text()).toContain("Connect your numbers");
});

it("picks a rival's row from its dot, and its dot from its row", async () => {
  await act(async () =>
    root.render(
      <BrandStep
        overview={draft({ brandBrain: mappedBrain, strategy: null })}
        messages={[]}
        onCorrect={noop}
        onSave={noop}
      />,
    ),
  );
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>("button.ob-tile")]
      .find((tile) => tile.textContent?.startsWith("Competitors"))
      ?.click(),
  );
  const dot = (name: string) =>
    [
      ...container.querySelectorAll<HTMLButtonElement>("button.ob-map-dot"),
    ].find((candidate) => candidate.textContent === name);
  const row = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("button.ob-rival")].find(
      (candidate) => candidate.querySelector("b")?.textContent === name,
    );
  const pressed = (element: HTMLElement | undefined) =>
    element?.getAttribute("aria-pressed");

  expect(pressed(dot("Moonshot"))).toBe("false");
  await act(async () => dot("Moonshot")?.click());
  expect(pressed(dot("Moonshot"))).toBe("true");
  expect(pressed(row("Moonshot"))).toBe("true");
  expect(pressed(row("Orbit Labs"))).toBe("false");

  await act(async () => row("Orbit Labs")?.click());
  expect(pressed(dot("Orbit Labs"))).toBe("true");
  expect(pressed(dot("Moonshot"))).toBe("false");
  expect(pressed(row("Moonshot"))).toBe("false");

  // Picking it again lets go.
  await act(async () => dot("Orbit Labs")?.click());
  expect(pressed(row("Orbit Labs"))).toBe("false");

  // A dot named a little longer still finds its row.
  await act(async () => row("Build it")?.click());
  expect(pressed(dot("Build it in house"))).toBe("true");

  // The founder's marker is a button too (name plus ", you" for screen readers).
  const you = [
    ...container.querySelectorAll<HTMLButtonElement>("button.ob-map-dot.you"),
  ].find((candidate) => candidate.textContent?.startsWith("Acme"));
  expect(you).toBeTruthy();
  await act(async () => you?.click());
  expect(pressed(you)).toBe("true");
});

it("lands each new account preview one at a time", async () => {
  vi.useFakeTimers();
  try {
    const at = (calendar: typeof sevenPlan.calendar) => (
      <PlanReview
        overview={draft({
          strategy: { ...sevenPlan, calendar },
          work: {
            kind: "strategy",
            status: "running",
            startedAt: new Date("2026-10-05T09:00:00Z"),
            steps: [],
            sections: [],
            sectionsSaved: 0,
            sectionsTotal: 0,
          },
        })}
        initialTab="month"
        onConnectMeasurement={async () => ({ url: null, error: null })}
      />
    );
    const frames = () =>
      container.querySelectorAll(".ob-showcases .ob-showcase-label").length;
    const newsletter = sevenPlan.calendar.filter(
      (entry) => entry.channel === "newsletter",
    );
    await act(async () => root.render(at(newsletter)));
    expect(frames()).toBe(1);
    await act(async () => root.render(at(sevenPlan.calendar)));
    expect(frames()).toBe(1);
    await act(async () => vi.advanceTimersByTime(LAND_MS));
    expect(frames()).toBe(2);
    for (let landed = 3; landed <= 7; landed++) {
      await act(async () => vi.advanceTimersByTime(LAND_MS));
      expect(frames()).toBe(landed);
    }
  } finally {
    vi.useRealTimers();
  }
});
