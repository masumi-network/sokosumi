// @vitest-environment happy-dom

import type { CmoOverview } from "@sokosumi/core-client";
import { MotionGlobalConfig } from "motion/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { cmoOverview, cmoStrategyVersion } from "../../test-fixtures/cmo";
import {
  asking,
  brain,
  draft,
  strategy,
  work,
} from "../../test-fixtures/onboarding";
import { Onboarding } from "../onboarding";
import { inertOnboardingActions, type OnboardingActions } from "./actions";
import { BrandStep } from "./brand-step";
import { OnboardingFlow } from "./flow";
import { LaunchStep } from "./launch-step";
import { PlanStep } from "./plan-step";
import { PRESS_MS, QuestionCard, useAnswers } from "./questions";

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

/** Clicks, and lets a tapped answer's press run out (PRESS_MS). */
async function press(text: string) {
  vi.useFakeTimers();
  try {
    await act(async () => {
      button(text).click();
      vi.advanceTimersByTime(PRESS_MS);
    });
  } finally {
    vi.useRealTimers();
  }
}
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

it("links a refused second hire to the person's unpaid Cuso", async () => {
  await act(async () =>
    root.render(
      <Onboarding
        onboard={async (previous) => ({
          ...previous,
          attempt: previous.attempt + 1,
          errors: { form: "Your Cuso for old.io is not subscribed yet." },
          unpaidCuso: { href: "/?project=project-0", businessName: "old.io" },
        })}
      />,
    ),
  );

  typeInto(container.querySelector("#ob-website"), "acme.io");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[type="submit"]')
      ?.click(),
  );

  const alert = container.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain("old.io");
  expect(alert?.querySelector("a")?.getAttribute("href")).toBe(
    "/?project=project-0",
  );
  expect(alert?.textContent).not.toContain("Top up");
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

it("answers No at once, and sends details typed first with the tap", async () => {
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
  expect(save).toHaveBeenLastCalledWith("no", undefined);
  await press("Add more details");
  typeInto(
    container.querySelector<HTMLInputElement>(
      'input[aria-label="More details"]',
    ),
    "Businesses",
  );
  await press("Yes");
  expect(save).toHaveBeenLastCalledWith("yes", "Businesses");
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
  // Everything is answered, so Brand is next; the Site waits for the founder.
  expect(text()).toContain("That's all I need.");
  expect(text()).not.toContain("Looks like us");
  await press("See your brand");
  expect(text()).toContain("Looks like us");
});

it("tells the founder they can close the page and come back", async () => {
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={asking()}
        messages={[]}
        actions={actionsFor()}
      />,
    ),
  );
  expect(text()).toContain(
    "You can close this page and come back any time to continue.",
  );
});

it("moves to the next question before the save returns", async () => {
  const actions = actionsFor({
    answerBrandQuestion: vi.fn(() => new Promise<CmoOverview>(() => {})),
  });
  await act(async () =>
    root.render(
      <OnboardingFlow overview={asking()} messages={[]} actions={actions} />,
    ),
  );
  await press("Yes");
  expect(text()).toContain("2 of 2");
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

it("lets the founder confirm while Cuso writes the plan he started, and shows its progress", async () => {
  // The plan starts when the research ends, before the founder confirms.
  const writing = asking({ botStatus: "RUNNING", work: work("strategy") });
  const actions = actionsFor({
    approveBrandBrain: vi.fn(async () =>
      asking({
        botStatus: "RUNNING",
        work: work("strategy"),
        brandBrainConfirmedAt: new Date(),
      }),
    ),
  });
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={writing}
        messages={[]}
        skipped={["questions"]}
        actions={actions}
      />,
    ),
  );
  expect(text()).not.toContain("Finishing up");
  expect(button("Looks like us").disabled).toBe(false);
  await press("Looks like us");
  // Core hands the running plan back; nothing new starts.
  expect(actions.requestStrategy).toHaveBeenCalledWith(undefined);
  expect(text()).toContain("Writing your strategy");
});

it("opens a plan Cuso already wrote on Looks like us, without planning again", async () => {
  const actions = actionsFor({ approveBrandBrain: vi.fn(async () => draft()) });
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={draft({ brandBrainConfirmedAt: null })}
        messages={[]}
        skipped={["questions"]}
        actions={actions}
      />,
    ),
  );
  await press("Looks like us");
  expect(actions.approveBrandBrain).toHaveBeenCalledTimes(1);
  expect(actions.requestStrategy).not.toHaveBeenCalled();
  expect(text()).toContain("Approve strategy");
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

it("clears the updating banner after the stale timeout when a correction goes unanswered", async () => {
  vi.useFakeTimers();
  try {
    const sent = vi.fn(async () => {});
    const renderStep = (botStatus: CmoOverview["botStatus"]) =>
      root.render(
        <BrandStep
          overview={draft({
            brandBrainConfirmedAt: null,
            strategy: null,
            botStatus,
          })}
          messages={[]}
          onCorrect={sent}
          onSave={noop}
          onAnswer={noop}
          onApprove={async () => null}
        />,
      );

    await act(async () => renderStep("IDLE"));

    const tile = [
      ...container.querySelectorAll<HTMLButtonElement>("button.ob-tile"),
    ].find((candidate) => candidate.textContent?.startsWith("What you sell"));
    await act(async () => tile?.click());
    typeInto(
      container.querySelector<HTMLInputElement>("aside #ob-tell"),
      "Price is $149",
    );
    await act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>("aside button")]
        .find((candidate) => candidate.textContent === "Send")
        ?.click(),
    );
    expect(text()).toContain("Updating your Brand Brain");

    // Idle bots time out after 30s if no reply arrives.
    await act(async () => {
      vi.advanceTimersByTime(29_999);
    });
    expect(text()).toContain("Updating your Brand Brain");

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(text()).not.toContain("Updating your Brand Brain");
    expect(text()).toContain("That change didn't come through.");

    // A new correction whose bot starts RUNNING switches to the 240s grace window.
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Close"]')
        ?.click(),
    );
    const reopenTile = [
      ...container.querySelectorAll<HTMLButtonElement>("button.ob-tile"),
    ].find((candidate) => candidate.textContent?.startsWith("What you sell"));
    await act(async () => reopenTile?.click());
    typeInto(
      container.querySelector<HTMLInputElement>("aside #ob-tell"),
      "Updated positioning",
    );
    await act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>("aside button")]
        .find((candidate) => candidate.textContent === "Send")
        ?.click(),
    );
    await act(async () => renderStep("RUNNING"));
    expect(text()).toContain("Updating your Brand Brain");

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(text()).toContain("Updating your Brand Brain");

    await act(async () => {
      vi.advanceTimersByTime(210_000);
    });
    expect(text()).not.toContain("Updating your Brand Brain");
    expect(text()).toContain("That change didn't come through.");
  } finally {
    vi.useRealTimers();
  }
});

// Brand during onboarding: Cuso writes the plan meanwhile, so a correction
// or an edit is a fix on its section, which Core runs after the plan and
// fits the plan to.

const writingPlan = (offerFix?: { fixed: boolean }) =>
  draft({
    brandBrainConfirmedAt: null,
    strategy: null,
    botStatus: "RUNNING",
    work: work("strategy", { change: null }),
    brandBrain: {
      ...brain,
      profile: {
        offer: {
          answer: "Rockets for founders",
          findings: [],
          ...(offerFix
            ? {
                fix: {
                  note: "Rocket Pro costs $149",
                  at: "2026-11-16T10:00:00Z",
                  ...offerFix,
                },
              }
            : {}),
        },
      },
    },
  });

async function openSell(
  overview: CmoOverview,
  onFix = vi.fn(async () => null),
) {
  const onCorrect = vi.fn(async () => {});
  const onSave = vi.fn(async () => {});
  await act(async () =>
    root.render(
      <BrandStep
        overview={overview}
        messages={[]}
        onCorrect={onCorrect}
        onFix={onFix}
        onSave={onSave}
        onAnswer={noop}
        onApprove={async () => null}
      />,
    ),
  );
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>("button.ob-tile")]
      .find((tile) => tile.textContent?.startsWith("What you sell"))
      ?.click(),
  );
  return { onCorrect, onSave, onFix };
}

it("sends a correction made while the plan is written as a fix on its section", async () => {
  const { onCorrect, onFix } = await openSell(writingPlan());
  typeInto(
    container.querySelector<HTMLInputElement>("#ob-tell"),
    "Rocket Pro costs $149",
  );
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>("aside button")]
      .find((candidate) => candidate.textContent === "Send")
      ?.click(),
  );
  expect(onFix).toHaveBeenCalledWith("offer", "Rocket Pro costs $149");
  expect(onCorrect).not.toHaveBeenCalled();
});

it("fits the plan to an edit the founder made before Looks like us", async () => {
  const { onCorrect, onSave, onFix } = await openSell(writingPlan());
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>("aside button")]
      .find((candidate) => candidate.textContent === "Edit")
      ?.click(),
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        'aside form.bp-editor button[type="submit"]',
      )
      ?.click(),
  );
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onFix).toHaveBeenCalledWith(
    "offer",
    expect.stringContaining("edited"),
  );
  expect(onCorrect).not.toHaveBeenCalled();
});

it("says a waiting fix follows the strategy, how long, and lets the founder approve", async () => {
  await openSell(writingPlan({ fixed: false }));
  expect(container.querySelector("aside")?.textContent).toContain(
    "Cuso is writing your strategy now. He makes this fix as soon as he is done, usually within 15 minutes",
  );
  expect(button("Looks like us").disabled).toBe(false);
});

it("holds Looks like us while Cuso runs a fix", async () => {
  await openSell({
    ...writingPlan({ fixed: false }),
    work: work("strategy", { change: "fix" }),
  });
  expect(container.querySelector("aside")?.textContent).toContain(
    "Cuso is fixing this now.",
  );
  expect(button("Cuso is updating").disabled).toBe(true);
});

it("wires the Brand step's fixes to Core's fix queue", async () => {
  const fixBrandSection = vi.fn(async () => null);
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={writingPlan()}
        messages={[]}
        skipped={["questions"]}
        actions={actionsFor({ fixBrandSection })}
      />,
    ),
  );
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>("button.ob-tile")]
      .find((tile) => tile.textContent?.startsWith("What you sell"))
      ?.click(),
  );
  typeInto(
    container.querySelector<HTMLInputElement>("#ob-tell"),
    "Rocket Pro costs $149",
  );
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>("aside button")]
      .find((candidate) => candidate.textContent === "Send")
      ?.click(),
  );
  expect(fixBrandSection).toHaveBeenCalledWith(
    "offer",
    "Rocket Pro costs $149",
  );
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

it("keeps the plan on screen and says Cuso is changing it while a brand fix patches it", async () => {
  await act(async () =>
    root.render(
      <PlanStep
        overview={draft({
          viewerCanApprove: true,
          work: work("strategy", { change: "fix" }),
        })}
        phase="review"
        onRequest={async () => null}
        onSetAds={async () => null}
        onAnswer={noop}
        onUpdate={async () => null}
        onApprove={noop}
        onConnectMeasurement={async () => ({ url: null, error: null })}
      />,
    ),
  );
  expect(planHidden()).toBe(false);
  expect(text()).toContain("Cuso is changing it");
});

it("leaves the volume to the plan: no pace to tap on the strategy", async () => {
  await renderPlan(
    async () => null,
    async () => null,
  );
  expect(() => button("All-in")).toThrow();
  expect(text()).toContain("This month is written at the most a plan makes.");
});

it("re-plans on a new ad budget at once, and keeps the amount when it is refused", async () => {
  const core = pending();
  await renderPlan(async () => null, core.call);
  // The strategy has ads, so Yes is picked and the amount shows.
  expect(button("Yes").getAttribute("aria-pressed")).toBe("true");
  const amount = 'input[aria-label="Monthly ad budget in EUR"]';
  typeInto(container.querySelector<HTMLInputElement>(amount), "450");
  await press("Change budget");

  expect(core.call).toHaveBeenCalledWith(450, "EUR");
  expect(replanning()).toBe(true);

  await act(async () => core.answer("Not enough credits"));
  expect(replanning()).toBe(false);
  expect(container.querySelector(amount)).not.toBeNull();
});

it("takes the ads out the moment the owner says No", async () => {
  const core = pending();
  await renderPlan(async () => null, core.call);
  await press("No");

  expect(core.call).toHaveBeenCalledWith(0, "EUR");
  expect(replanning()).toBe(true);
  await act(async () => core.answer(null));
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
  ).toBe("Your funnel");
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
  expect(active?.textContent).toBe("Your funnel");
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

it("clears the hiring measurement return error after leaving Results and returning via tabs or Brand", async () => {
  const expectedError = "That connection didn't finish. Try again.";
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={draft({ viewerCanApprove: true })}
        messages={[]}
        initialStep="results"
        measureError={expectedError}
        skipped={["questions"]}
        actions={actionsFor()}
      />,
    ),
  );

  expect(
    container.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
  ).toBe("How we know it works");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    expectedError,
  );

  await act(async () =>
    [...container.querySelectorAll<HTMLElement>('[role="tab"]')]
      .find((tab) => tab.textContent === "Your month")
      ?.click(),
  );
  expect(text()).toContain("Up first");

  await act(async () =>
    [...container.querySelectorAll<HTMLElement>('[role="tab"]')]
      .find((tab) => tab.textContent === "How we know it works")
      ?.click(),
  );
  expect(text()).toContain("Connect your numbers");
  expect(container.querySelector('[role="alert"]')).toBeNull();

  // Leaving Strategy to Brand and returning remounts PlanReview; the consumed
  // error must not come back.
  await act(async () =>
    container
      .querySelectorAll<HTMLButtonElement>(".ob-steps button")[0]
      ?.click(),
  );
  expect(text()).toContain("Here's acme.io as I see it.");

  await press("Continue to Strategy");
  expect(
    container.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
  ).toBe("How we know it works");
  expect(container.querySelector('[role="alert"]')).toBeNull();
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
  expect(text()).toContain("Writing your strategy");
  expect(text()).not.toContain("Write my strategy");
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
  expect(text()).toContain("Write my strategy");
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
  expect(text()).toContain("Write my strategy");
  await press("Write my strategy");
  expect(text()).toContain("Write my strategy");
  expect(text()).toContain("That didn't go through");
  expect(text()).not.toContain("Writing your strategy");
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
  expect(text()).toContain("Approve strategy");
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
  expect(text()).not.toContain("Approve strategy");
  await press("Continue to Strategy");
  expect(text()).toContain("Approve strategy");
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
  expect(text()).toContain("Update strategy");
  expect(text()).not.toContain("Approve strategy");
  await press("Update strategy");
  expect(actions.applyPlanAnswers).toHaveBeenCalledTimes(1);
  expect(text()).toContain("Fitting your strategy to your answers");
  await act(async () => fitting.answer(null));
});

it("offers no approval for a month short of what it promises, only a new strategy", async () => {
  const actions = planActions({
    requestStrategy: vi.fn(async () => ({ overview: null, error: null })),
  });
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={{
          ...planOverview(),
          strategyShort: { planned: 64, promised: 172 },
        }}
        messages={[]}
        actions={actions}
      />,
    ),
  );
  expect(text()).toContain(
    "This strategy plans 64 posts, but it promises about 172.",
  );
  expect(text()).not.toContain("Approve strategy");
  await press("Write it again");
  expect(actions.requestStrategy).toHaveBeenCalledWith(undefined);
  expect(actions.approveStrategy).not.toHaveBeenCalled();
});

it("says a month promises more than it holds when only a video is missing", async () => {
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={{
          ...planOverview(),
          strategyShort: { planned: 80, promised: 80 },
        }}
        messages={[]}
        actions={planActions()}
      />,
    ),
  );
  expect(text()).toContain(
    "This strategy promises more than its calendar holds.",
  );
  expect(text()).not.toContain("Approve strategy");
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
  await press("Approve strategy");
  expect(actions.approveStrategy).toHaveBeenCalledTimes(1);
  expect(text()).toContain("One thing, then I start.");
});

// Launch: the celebration shows at once; Go to Today records the finish (flow.tsx).

const active = {
  id: "x",
  provider: "x",
  handle: "acme",
  displayName: "Acme",
  status: "ACTIVE",
  personalProfile: false,
};

it("brings a failed connection's reason into view, below the networks", async () => {
  const scrolled = vi.fn();
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = scrolled;
  await act(async () =>
    root.render(
      <LaunchStep
        overview={draft({ ...cmoStrategyVersion(new Date()), channels: [] })}
        onConnect={async () => ({
          url: null,
          error: "Could not start connecting",
        })}
        onConnectAds={async () => ({ url: null, error: null })}
        onSetPresenter={async () => ({ error: null })}
        onClearPresenter={async () => ({ error: null })}
        onGoToday={() => {}}
      />,
    ),
  );
  expect(scrolled).not.toHaveBeenCalled();
  await press("Connect");
  const alert = container.querySelector('[role="alert"]');
  expect(alert?.textContent).toBe("Could not start connecting");
  expect(scrolled.mock.contexts).toContain(alert);
  Element.prototype.scrollIntoView = original;
});

it("celebrates on Launch without a failure in between, then opens the app on Go to Today", async () => {
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
        onSetPresenter={async () => ({ error: null })}
        onClearPresenter={async () => ({ error: null })}
        onGoToday={goToday}
      />,
    ),
  );
  expect(text()).not.toContain("is on it.");
  await press("Launch Cuso");
  // Launch calls no server action, so no "Could not launch" shows first.
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(text()).not.toContain("Could not launch");
  expect(text()).toContain("Cuso is on it.");
  expect(text()).not.toContain("posts a week");
  expect(text()).toContain("€200 a month");
  expect(text()).toContain("posts on your strategy's schedule");
  expect(text()).not.toContain("Nothing posts until");
  expect(text()).toContain("LinkedIn and X");
  expect(text()).not.toContain("Approvals");
  expect(goToday).not.toHaveBeenCalled();
  await press("Change settings");
  expect(text()).toContain("One thing, then I start.");
  await press("Launch Cuso");
  await press("Go to Today");
  expect(goToday).toHaveBeenCalledTimes(1);
});
