// @vitest-environment happy-dom

import type { CmoOverview } from "@sokosumi/core-client";
import { MotionGlobalConfig } from "motion/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { cmoOverview, cmoStrategyVersion } from "../../test-fixtures/cmo";
import { asking, brain, draft, strategy } from "../../test-fixtures/onboarding";
import { BrandStep } from "./brand-step";
import { type OnboardingActions, OnboardingFlow } from "./flow";
import { LaunchStep } from "./launch-step";
import { QuestionCard, useAnswers } from "./parts";
import { PlanStep } from "./plan-step";

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

/** A Core call the test answers when it chooses. */
function pending() {
  let answer = (_refusal: string | null) => {};
  const call = vi.fn(
    () => new Promise<string | null>((resolve) => (answer = resolve)),
  );
  return { call, answer: (refusal: string | null) => answer(refusal) };
}

function typeInto(input: HTMLInputElement | null, value: string) {
  if (!input) throw new Error("No input");
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const noop = async () => {};

// The questions: a tap shows at once, a failed save takes it back.

const QUESTION = {
  id: "households",
  question: "Are households your largest customer group?",
};

function Card({ save }: { save: () => Promise<void> }) {
  const [[question], answer] = useAnswers([QUESTION], save);
  return (
    <QuestionCard
      question={question as typeof QUESTION}
      topic="Target customers"
      index={0}
      answered={[false]}
      onAnswer={(value, note) => answer(QUESTION.id, value, note)}
    />
  );
}

it("shows a tapped answer at once, before the save returns", async () => {
  let finish = () => {};
  await act(async () =>
    root.render(
      <Card save={() => new Promise<void>((resolve) => (finish = resolve))} />,
    ),
  );
  await press("Yes");
  expect(button("Yes").getAttribute("aria-pressed")).toBe("true");
  expect(button("No").disabled).toBe(false);
  await act(async () => finish());
});

it("takes the answer back and says so when the save fails", async () => {
  let fail = () => {};
  await act(async () =>
    root.render(
      <Card
        save={() =>
          new Promise<void>((_, reject) => (fail = () => reject(new Error())))
        }
      />,
    ),
  );
  await press("Not sure");
  expect(button("Not sure").getAttribute("aria-pressed")).toBe("true");
  await act(async () => fail());
  expect(button("Not sure").getAttribute("aria-pressed")).toBe("false");
  expect(text()).toContain("That didn't save.");
});

it("keeps a no's note behaviour: No opens a line for what is true instead", async () => {
  const save = vi.fn(async () => {});
  await act(async () =>
    root.render(
      <QuestionCard
        question={QUESTION}
        topic="Target customers"
        index={0}
        answered={[false]}
        onAnswer={save}
      />,
    ),
  );
  await press("No");
  expect(save).not.toHaveBeenCalled();
  typeInto(
    container.querySelector<HTMLInputElement>(
      'input[aria-label="What\'s true instead"]',
    ),
    "Businesses",
  );
  await press("Save");
  expect(save).toHaveBeenCalledWith("no", "Businesses");
});

// Site, held until the founder moves on.

function actionsFor(overrides: Partial<OnboardingActions> = {}) {
  const answered = new Map<string, "yes" | "no" | "unsure">();
  const withAnswers = (): CmoOverview => ({
    ...asking(),
    brandBrain: {
      ...brain,
      questions: (brain.questions ?? []).map((question) => ({
        ...question,
        answer: answered.get(question.id),
      })),
    },
  });
  const actions = {
    loadState: async () => ({ overview: null, messages: [] }),
    sendMessage: noop,
    retryLearning: async () => ({ overview: asking(), error: null }),
    requestStrategy: vi.fn(async () => ({ overview: null, error: null })),
    approveStrategy: vi.fn(async () => draft(cmoStrategyVersion(new Date()))),
    setAdBudget: async () => ({ overview: null, error: null }),
    approveBrandBrain: vi.fn(async () => draft()),
    answerBrandQuestion: vi.fn(async ({ questionId, answer }) => {
      answered.set(questionId, answer);
      return withAnswers();
    }),
    skipBrandQuestions: vi.fn(async () => asking()),
    saveBrandBrain: async () => asking(),
    answerPlanQuestion: async () => draft(),
    applyPlanAnswers: async () => ({ overview: null, error: null }),
    finishAccounts: vi.fn(async () => undefined as never),
    connectChannel: async () => ({ url: null, error: null }),
    connectMeasurement: async () => ({ url: null, error: null }),
    connectAds: async () => ({ url: null, error: null }),
    startOver: async () => null,
    signOut: noop,
    ...overrides,
  } satisfies OnboardingActions;
  return actions;
}

it("keeps a finished Site on screen until See your brand", async () => {
  const actions = actionsFor();
  await act(async () =>
    root.render(
      <OnboardingFlow overview={asking()} messages={[]} actions={actions} />,
    ),
  );
  expect(text()).toContain("1 of 2");
  await press("Yes");
  expect(text()).toContain("2 of 2");
  await press("No");
  await press("Save");
  // Everything is answered, so Brand is next; the Site waits for the founder.
  expect(text()).toContain("That's all I need.");
  expect(text()).not.toContain("Looks like us");
  await press("See your brand");
  expect(text()).toContain("Looks like us");
});

it("lets the founder change answers from the finished Site", async () => {
  const actions = actionsFor();
  await act(async () =>
    root.render(
      <OnboardingFlow overview={asking()} messages={[]} actions={actions} />,
    ),
  );
  await press("Yes");
  await press("Not sure");
  expect(text()).toContain("That's all I need.");
  await press("Change answers");
  expect(text()).toContain("1 of 2");
  expect(button("Yes").getAttribute("aria-pressed")).toBe("true");
});

it("skips the questions for later and still reaches Brand", async () => {
  const actions = actionsFor();
  await act(async () =>
    root.render(
      <OnboardingFlow overview={asking()} messages={[]} actions={actions} />,
    ),
  );
  await press("Skip for now");
  expect(actions.skipBrandQuestions).toHaveBeenCalledTimes(1);
  expect(text()).toContain("That's all I need.");
  await press("See your brand");
  expect(text()).toContain("Looks like us");
  expect(text()).toContain("2 questions left");
});

it("opens Brand directly on a reload with nothing left to ask", async () => {
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={asking()}
        messages={[]}
        skipped={["questions"]}
        actions={actionsFor()}
      />,
    ),
  );
  expect(text()).toContain("Looks like us");
  expect(text()).not.toContain("That's all I need.");
});

it("approves the Brand Brain, then asks for the plan", async () => {
  const actions = actionsFor();
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={asking()}
        messages={[]}
        skipped={["questions"]}
        actions={actions}
      />,
    ),
  );
  await press("Looks like us");
  expect(actions.approveBrandBrain).toHaveBeenCalledTimes(1);
  expect(actions.requestStrategy).toHaveBeenCalledWith(undefined);
});

// Brand: a tile opens the side panel.

it("opens a tile into the side panel with a way to say what is off", async () => {
  const sent = vi.fn(async () => {});
  await act(async () =>
    root.render(
      <BrandStep
        overview={draft({ brandBrainConfirmedAt: null, strategy: null })}
        messages={[]}
        onCorrect={sent}
        onSave={noop}
        onAnswer={noop}
        onApprove={async () => null}
      />,
    ),
  );
  expect(container.querySelector("aside")).toBeNull();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Details: What you sell"]')
      ?.click(),
  );
  expect(button("Open").getAttribute("aria-pressed")).toBe("true");
  const panel = container.querySelector("aside");
  expect(panel?.getAttribute("aria-label")).toBe("What you sell");
  expect(panel?.textContent).toContain("Rocket Pro");
  typeInto(
    panel?.querySelector<HTMLInputElement>(
      'input[aria-label="Tell Cuso what\'s off"]',
    ) ?? null,
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

// Plan: a change, a pace, a budget put the plan away until Cuso answers.

async function renderPlan(
  onRequest: (note?: string) => Promise<string | null>,
  onSetAds: (monthly: number, currency: string) => Promise<string | null>,
) {
  await act(async () =>
    root.render(
      <PlanStep
        overview={cmoOverview({
          onboardingStep: "strategy",
          viewerCanApprove: true,
          strategy: {
            ...strategy,
            pace: { level: "active", why: "One a day", perWeek: 7 },
            ads: {
              monthly: 300,
              currency: "EUR",
              expect: "Some sales",
              without: "Organic only",
            },
          },
        })}
        phase="review"
        onRequest={onRequest}
        onSetAds={onSetAds}
        onAnswer={noop}
        onUpdate={async () => null}
        onApprove={noop}
        onConnectMeasurement={async () => ({ url: null, error: null })}
        ahead={{ label: "Launch", onClick: () => {} }}
      />,
    ),
  );
}

const planHidden = () =>
  container.querySelector(".ob-plan-body")?.hasAttribute("hidden");
const replanning = () => text().includes("Cuso is re-planning your month");

it("swaps the plan for a re-planning screen the moment a pace is tapped", async () => {
  const core = pending();
  await renderPlan(core.call, async () => null);
  await press("All-in");

  expect(core.call).toHaveBeenCalledWith(
    expect.stringContaining("Change the pace to All-in"),
  );
  expect(replanning()).toBe(true);
  expect(text()).toContain("All-in pace.");
  expect(planHidden()).toBe(true);

  await act(async () => core.answer("Not enough credits"));
  expect(replanning()).toBe(false);
  expect(planHidden()).toBe(false);
  expect(text()).toContain("You're out of credits.");
});

it("re-plans on a new ad budget at once, and keeps the amount when it is refused", async () => {
  const core = pending();
  await renderPlan(async () => null, core.call);
  await press("Change");
  await press("Set your own budget");
  const amount = 'input[aria-label="Monthly ad budget in EUR"]';
  expect(container.querySelector(amount)).not.toBeNull();
  await press("Set budget");

  expect(core.call).toHaveBeenCalledWith(300, "EUR");
  expect(replanning()).toBe(true);

  await act(async () => core.answer("Not enough credits"));
  expect(replanning()).toBe(false);
  expect(container.querySelector(amount)).not.toBeNull();
});

it("shows the re-planning screen for a written change before Core answers", async () => {
  const core = pending();
  await renderPlan(core.call, async () => null);
  await press("Ask for a change");
  typeInto(
    container.querySelector<HTMLInputElement>(
      'input[aria-label="What should Cuso change?"]',
    ),
    "More videos",
  );
  await press("Change it");

  expect(core.call).toHaveBeenCalledWith("More videos");
  expect(replanning()).toBe(true);

  await act(async () => core.answer(null));
  expect(replanning()).toBe(false);
});

it("opens the tab the founder picks, and keeps Results one tap away", async () => {
  await renderPlan(
    async () => null,
    async () => null,
  );
  expect(
    container.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
  ).toBe("The plan");
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

// Launch: the celebration comes only after Launch.

const active = {
  id: "x",
  provider: "x",
  handle: "acme",
  displayName: "Acme",
  status: "ACTIVE",
};

it("celebrates only after Launch, then opens the app on Go to Today", async () => {
  const finish = vi.fn(async () => {});
  await act(async () =>
    root.render(
      <LaunchStep
        overview={draft({
          ...cmoStrategyVersion(new Date()),
          channels: [active],
          strategy: {
            ...strategy,
            pace: { level: "active", why: "One a day", perWeek: 7 },
            ads: {
              monthly: 200,
              currency: "EUR",
              expect: "Some sales",
              without: "Organic only",
            },
          },
        })}
        onConnect={async () => ({ url: null, error: null })}
        onConnectAds={async () => ({ url: null, error: null })}
        onContinue={finish}
      />,
    ),
  );
  expect(text()).not.toContain("is on it.");
  await press("Launch Cuso");
  expect(text()).toContain("Cuso is on it.");
  expect(text()).toContain("Active, 7 pieces a week");
  expect(text()).toContain("€200 a month");
  expect(text()).toContain("LinkedIn and X");
  expect(finish).not.toHaveBeenCalled();
  await press("Change settings");
  expect(text()).toContain("One thing, then I start.");
  await press("Launch Cuso");
  await press("Go to Today");
  expect(finish).toHaveBeenCalledTimes(1);
});
