// @vitest-environment happy-dom

import type { CmoOverview } from "@sokosumi/core-client";
import { MotionGlobalConfig } from "motion/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { cmoOverview, cmoStrategyVersion } from "../../test-fixtures/cmo";
import { asking, brain, draft, strategy } from "../../test-fixtures/onboarding";
import { Onboarding } from "../onboarding";
import { inertOnboardingActions, type OnboardingActions } from "./actions";
import { BrandStep } from "./brand-step";
import { OnboardingFlow } from "./flow";
import { LaunchStep } from "./launch-step";
import { PlanStep } from "./plan-step";
import { QuestionCard, useAnswers } from "./questions";

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

it("opens the Cuso picker from the hire form account menu", async () => {
  await act(async () =>
    root.render(
      <Onboarding signOut={noop} onboard={async (previous) => previous} />,
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
  return {
    ...inertOnboardingActions(asking()),
    retryLearning: async () => ({ overview: asking(), error: null }),
    requestStrategy: vi.fn(async () => ({ overview: null, error: null })),
    approveStrategy: vi.fn(async () => draft(cmoStrategyVersion(new Date()))),
    approveBrandBrain: vi.fn(async () => draft()),
    answerBrandQuestion: vi.fn(async ({ questionId, answer }) => {
      answered.set(questionId, answer);
      return withAnswers();
    }),
    skipBrandQuestions: vi.fn(async () => asking()),
    saveBrandBrain: async () => asking(),
    answerPlanQuestion: async () => draft(),
    finishAccounts: vi.fn(() => new Promise<never>(() => {})),
    signOut: noop,
    ...overrides,
  } satisfies OnboardingActions;
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

it("shows Skip at once as a finished card, pending until it lands", async () => {
  let land = () => {};
  const actions = actionsFor({
    skipBrandQuestions: vi.fn(
      () =>
        new Promise<CmoOverview>((resolve) => (land = () => resolve(asking()))),
    ),
  });
  await act(async () =>
    root.render(
      <OnboardingFlow overview={asking()} messages={[]} actions={actions} />,
    ),
  );
  await press("Skip for now");
  expect(text()).toContain("That's all I need.");
  expect(button("Skipping").disabled).toBe(true);
  await act(async () => land());
  expect(button("See your brand").disabled).toBe(false);
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
        onAnswer={noop}
        onApprove={async () => null}
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
    container.querySelector<HTMLInputElement>("#ob-change-input"),
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
  await renderPlan(
    async () => null,
    async () => null,
  );
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

// Asking for the plan: no second offer while the request is in flight.

it("holds Plan as writing once the plan is requested, until Core reports it", async () => {
  const actions = actionsFor({
    approveBrandBrain: vi.fn(async () => draft({ strategy: null })),
    requestStrategy: vi.fn(async () => ({ overview: null, error: null })),
  });
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={draft({ brandBrainConfirmedAt: null, strategy: null })}
        messages={[]}
        skipped={["questions"]}
        actions={actions}
      />,
    ),
  );
  await press("Looks like us");
  expect(actions.requestStrategy).toHaveBeenCalledTimes(1);
  expect(text()).toContain("Writing your plan");
  expect(text()).not.toContain("Write my plan");
});

it("offers Write my plan again when the request is refused", async () => {
  const actions = actionsFor({
    approveBrandBrain: vi.fn(async () => draft({ strategy: null })),
    requestStrategy: vi.fn(async () => ({
      overview: null,
      error: "Not enough credits",
    })),
  });
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={draft({ brandBrainConfirmedAt: null, strategy: null })}
        messages={[]}
        skipped={["questions"]}
        actions={actions}
      />,
    ),
  );
  await press("Looks like us");
  expect(text()).toContain("Write my plan");
});

it("offers Write my plan again when the request throws", async () => {
  const actions = actionsFor({
    requestStrategy: vi.fn(async () => {
      throw new Error("connection lost");
    }),
  });
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={draft({ strategy: null })}
        messages={[]}
        skipped={["questions"]}
        actions={actions}
      />,
    ),
  );
  expect(text()).toContain("Write my plan");
  await press("Write my plan");
  expect(text()).toContain("Write my plan");
  expect(text()).toContain("That didn't go through");
  expect(text()).not.toContain("Writing your plan");
});

// Revisiting a finished step from the markers.

const markerButtons = () =>
  [...container.querySelectorAll(".ob-steps button")].map((element) =>
    element.textContent?.replace(/^\d/, ""),
  );

it("revisits Brand from the markers and leads forward again, never back to Site", async () => {
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={draft()}
        messages={[]}
        skipped={["questions"]}
        actions={actionsFor()}
      />,
    ),
  );
  expect(text()).toContain("Approve plan");
  // Site is done but not revisitable; Brand is.
  expect(markerButtons()).toEqual(["Brand"]);
  await act(async () =>
    container
      .querySelectorAll<HTMLButtonElement>(".ob-steps button")[0]
      ?.click(),
  );
  expect(text()).toContain("Here's acme.io as I see it.");
  expect(
    container.querySelector(".ob-step.now")?.getAttribute("aria-current"),
  ).toBe("step");
  expect(text()).not.toContain("Approve plan");
  await press("Continue to Plan");
  expect(text()).toContain("Approve plan");
});

// Plan chips and the way to Launch, through the real flow.

const planQuestions = [
  { id: "p1", question: "Do you ship every month?", statement: "They ship." },
  { id: "p2", question: "Are buyers on LinkedIn?", statement: "They are." },
];

function planOverview(
  answers: Record<
    string,
    { answer: "yes" | "no" | "unsure"; note?: string }
  > = {},
): CmoOverview {
  return draft({
    strategy: {
      ...strategy,
      changes: [],
      questions: planQuestions.map((question) => ({
        ...question,
        ...answers[question.id],
      })),
    },
  });
}

function planActions(overrides: Partial<OnboardingActions> = {}) {
  const answers: Record<
    string,
    { answer: "yes" | "no" | "unsure"; note?: string }
  > = {};
  return actionsFor({
    answerPlanQuestion: vi.fn(async ({ questionId, answer, note }) => {
      answers[questionId] = { answer, note };
      return planOverview(answers);
    }),
    applyPlanAnswers: vi.fn(async () => ({ overview: null, error: null })),
    ...overrides,
  });
}

const buttonsNamed = (label: string) =>
  [...container.querySelectorAll("button")].filter(
    (element) => element.textContent === label,
  );

it("saves a Yes on a plan chip", async () => {
  const actions = planActions();
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={planOverview()}
        messages={[]}
        actions={actions}
      />,
    ),
  );
  await act(async () => buttonsNamed("Yes")[0]?.click());
  expect(actions.answerPlanQuestion).toHaveBeenCalledWith({
    questionId: "p1",
    answer: "yes",
    note: undefined,
  });
  expect(buttonsNamed("Yes")[0]?.getAttribute("aria-pressed")).toBe("true");
});

it("round-trips Not sure on a plan chip", async () => {
  const actions = planActions();
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={planOverview({ p2: { answer: "unsure" } })}
        messages={[]}
        actions={actions}
      />,
    ),
  );
  // A stored unsure shows as pressed.
  expect(buttonsNamed("Not sure")[1]?.getAttribute("aria-pressed")).toBe(
    "true",
  );
  await act(async () => buttonsNamed("Not sure")[0]?.click());
  expect(actions.answerPlanQuestion).toHaveBeenCalledWith({
    questionId: "p1",
    answer: "unsure",
    note: undefined,
  });
  expect(buttonsNamed("Not sure")[0]?.getAttribute("aria-pressed")).toBe(
    "true",
  );
});

it("updates the plan after a No with a note, and shows it fitting", async () => {
  const fitting = pending();
  const actions = planActions({
    applyPlanAnswers: vi.fn(async () => ({
      overview: null,
      error: await fitting.call(),
    })),
  });
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={planOverview()}
        messages={[]}
        actions={actions}
      />,
    ),
  );
  await act(async () => buttonsNamed("No")[0]?.click());
  typeInto(
    container.querySelector<HTMLInputElement>(
      'input[aria-label="What\'s true instead"]',
    ),
    "Every week",
  );
  await press("Save");
  expect(actions.answerPlanQuestion).toHaveBeenCalledWith({
    questionId: "p1",
    answer: "no",
    note: "Every week",
  });
  expect(text()).toContain("Update plan");
  expect(text()).not.toContain("Approve plan");
  await press("Update plan");
  expect(actions.applyPlanAnswers).toHaveBeenCalledTimes(1);
  expect(text()).toContain("Fitting your plan to your answers");
  await act(async () => fitting.answer(null));
});

it("approves the plan and lands on Launch", async () => {
  const actions = planActions({
    approveStrategy: vi.fn(async () => draft(cmoStrategyVersion(new Date()))),
  });
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={planOverview()}
        messages={[]}
        actions={actions}
      />,
    ),
  );
  await press("Approve plan");
  expect(actions.approveStrategy).toHaveBeenCalledTimes(1);
  expect(text()).toContain("One thing, then I start.");
});

// Launch: the celebration shows after onLaunch; Go to Today records the finish (flow.tsx).

const active = {
  id: "x",
  provider: "x",
  handle: "acme",
  displayName: "Acme",
  status: "ACTIVE",
};

it("celebrates after Launch, then opens the app on Go to Today", async () => {
  let finish = () => {};
  const onLaunch = vi.fn(
    () => new Promise<void>((resolve) => (finish = resolve)),
  );
  const goToday = vi.fn();
  await act(async () =>
    root.render(
      <LaunchStep
        overview={draft({
          ...cmoStrategyVersion(new Date()),
          channels: [
            active,
            { ...active, id: "li", provider: "linkedin" },
            { ...active, id: "yt", provider: "youtube", status: "PAUSED" },
          ],
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
        onLaunch={onLaunch}
        onGoToday={goToday}
      />,
    ),
  );
  expect(text()).not.toContain("is on it.");
  await press("Launch Cuso");
  // The celebration waits for onLaunch.
  expect(onLaunch).toHaveBeenCalledTimes(1);
  expect(text()).not.toContain("is on it.");
  await act(async () => finish());
  expect(text()).toContain("Cuso is on it.");
  expect(text()).toContain("Active, 7 pieces a week");
  expect(text()).toContain("€200 a month");
  expect(text()).toContain("posts on your plan's schedule");
  expect(text()).not.toContain("Nothing posts until");
  expect(text()).toContain("LinkedIn and X");
  expect(text()).not.toContain("Approvals");
  expect(goToday).not.toHaveBeenCalled();
  await press("Change settings");
  expect(text()).toContain("One thing, then I start.");
  await press("Launch Cuso");
  await act(async () => finish());
  await press("Go to Today");
  expect(goToday).toHaveBeenCalledTimes(1);
});
