// @vitest-environment happy-dom

import type { CmoOverview } from "@sokosumi/core-client";
import { MotionGlobalConfig } from "motion/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cmoStrategyVersion } from "../../test-fixtures/cmo";
import {
  asking,
  brain,
  draft,
  reading,
  research,
  strategy,
  work,
} from "../../test-fixtures/onboarding";
import { inertOnboardingActions, type OnboardingActions } from "./actions";
import type { BriefDone } from "./brief";
import { OnboardingFlow } from "./flow";

// happy-dom cannot run Web Animations; motion's would reject on unmount.
MotionGlobalConfig.skipAnimations = true;

type Strategy = NonNullable<CmoOverview["strategy"]>;

let container: HTMLDivElement;
let root: Root;
let assign: ReturnType<typeof vi.fn<(url: string | URL) => void>>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  assign = vi.fn<(url: string | URL) => void>();
  vi.spyOn(window.location, "assign").mockImplementation(assign);
  window.localStorage.clear();
  window.scrollTo = vi.fn();
  document.title = "CMO.xyz";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const text = () => container.textContent ?? "";

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label,
  );
  if (!found) throw new Error(`No button "${label}"`);
  return found;
}

const press = (label: string) => act(async () => button(label).click());

function typeInto(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`No input ${selector}`);
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function actionsFor(
  overview: CmoOverview,
  overrides: Partial<OnboardingActions> = {},
): OnboardingActions {
  return { ...inertOnboardingActions(overview), ...overrides };
}

async function render(
  overview: CmoOverview,
  actions: OnboardingActions = actionsFor(overview),
  props: { briefed?: BriefDone[]; launched?: boolean } = {},
) {
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={overview}
        messages={[]}
        actions={actions}
        welcome={false}
        {...props}
      />,
    ),
  );
}

type PlanQuestion = NonNullable<Strategy["questions"]>[number];
const [firstCheck, secondCheck] = [
  {
    id: "pq1",
    question: "Do you ship every month?",
    statement: "They ship monthly.",
  },
  {
    id: "pq2",
    question: "Can I quote Lena?",
    statement: "Thursday quotes Lena.",
  },
] as [PlanQuestion, PlanQuestion];

/** A plan with every briefing step: a pace, three checks and search ads. */
const fullPlan: Strategy = {
  ...strategy,
  changes: [],
  pace: { level: "active", why: "One a day", perWeek: 7 },
  ads: {
    monthly: 300,
    currency: "USD",
    expect: "Sign-ups",
    without: "Posts only",
    setByOwner: false,
  },
  calendar: [
    ...strategy.calendar,
    {
      id: "ad-1",
      date: "2026-10-13",
      channel: "google_ads",
      format: "search_ad",
      status: "idea",
      title: "Rockets for teams",
    },
  ],
  questions: [firstCheck, secondCheck],
};

describe("working", () => {
  it("says what Cuso does in a polite live region, and that nothing needs you", async () => {
    await render(
      reading({
        research: research(2),
        work: work("research", { startedAt: new Date() }),
      }),
    );
    const live = container.querySelector('.brief-bar [role="status"]');
    expect(live?.textContent).toContain(
      "Reading your site and 6 places around it",
    );
    expect(live?.textContent).toContain("Now: Reading acme.io/pricing");
    expect(text()).toContain("2 of 6 groups");
    expect(text()).toContain("Nothing needs you. You can close this tab.");
    expect(container.querySelector("[data-brief-question]")).toBeNull();
    expect(text()).not.toMatch(/\bmin\b/);
  });

  it("marks the stage on the timeline, and folds it into one line for a phone", async () => {
    await render(
      reading({ work: work("research", { startedAt: new Date() }) }),
    );
    const now = container.querySelector('[aria-current="step"]');
    expect(now?.textContent).toContain("2 Research");
    expect(container.querySelector(".brief-fold")?.textContent).toBe(
      "Step 2 of 7 · ResearchNext: a few questions",
    );
  });
});

describe("the phone's progress strip", () => {
  it("draws seven segments under the step line, marked like the timeline", async () => {
    // The brand check, with the plan writing behind it.
    await render(
      asking({
        brandBrain: { ...brain, questions: [] },
        work: work("strategy"),
      }),
    );
    const strip = container.querySelector(".brief-fold-strip");
    expect(strip?.getAttribute("aria-hidden")).toBe("true");
    expect(
      [...(strip?.children ?? [])].map((segment) => segment.className),
    ).toEqual(["done", "done", "now", "background", "next", "next", "next"]);
    // The step line stays the readable label.
    expect(container.querySelector(".brief-fold")?.textContent).toContain(
      "Step 3 of 7 · Brand check",
    );
  });
});

describe("the chat asks, one thing at a time", () => {
  it("asks a brand question with its count, focuses it and saves the answer", async () => {
    const answerBrandQuestion = vi.fn(async () => asking());
    const overview = asking({ work: work("research") });
    await render(overview, actionsFor(overview, { answerBrandQuestion }));

    expect(text()).toContain("Cuso needs you · 1 of 2");
    const question = container.querySelector("[data-brief-question]");
    expect(question?.textContent).toBe(
      "Do most customers find you through Google?",
    );
    expect(document.activeElement).toBe(question);
    expect(document.title).toBe("(2) Cuso needs you");

    await press("Yes");
    expect(answerBrandQuestion).toHaveBeenCalledWith({
      questionId: "q1",
      answer: "yes",
      note: undefined,
    });
  });

  it("sends a no with what is true as a fix to its section once the read is in", async () => {
    const fixBrandSection = vi.fn(async () => null);
    const overview = asking();
    await render(
      overview,
      actionsFor(overview, {
        fixBrandSection,
        answerBrandQuestion: async () => overview,
      }),
    );
    typeInto("#brief-brand-note", "Mostly LinkedIn");
    await press("Send");
    expect(fixBrandSection).toHaveBeenCalledWith(
      "marketing",
      "Mostly LinkedIn",
    );
  });

  it("sends no fix while Cuso still reads: the plan takes the no in", async () => {
    const fixBrandSection = vi.fn(async () => null);
    const overview = asking({ work: work("research") });
    await render(overview, actionsFor(overview, { fixBrandSection }));
    await press("No");
    expect(fixBrandSection).not.toHaveBeenCalled();
  });

  it("says why Core refused the fix a no sent", async () => {
    const overview = asking();
    await render(
      overview,
      actionsFor(overview, {
        fixBrandSection: async () => "You're out of credits.",
      }),
    );
    await press("No");
    expect(text()).toContain("You're out of credits.");
  });

  it("skips the brand questions on Later and moves on to the brand check", async () => {
    const skipBrandQuestions = vi.fn(async () => asking());
    const overview = asking();
    await render(overview, actionsFor(overview, { skipBrandQuestions }));
    await press("Later");
    expect(skipBrandQuestions).toHaveBeenCalled();
    expect(container.querySelector("[data-brief-question]")?.textContent).toBe(
      "Did I get Acme right?",
    );
  });

  it("folds the chat on Esc and opens it again, focused on the question", async () => {
    await render(asking({ brandBrain: { ...brain, questions: [] } }));
    // Esc on the page (a sheet's own Esc) leaves the chat open.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(container.querySelector("[data-brief-question]")).not.toBeNull();
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(container.querySelector("[data-brief-question]")).toBeNull();
    expect(text()).toContain("1 thing waits");
    await press("Open");
    const question = container.querySelector("[data-brief-question]");
    expect(question?.textContent).toBe("Did I get Acme right?");
    expect(document.activeElement).toBe(question);
  });
});

describe("chat details", () => {
  it("keeps a typed note when Esc is pressed in its field", async () => {
    await render(asking());
    typeInto("#brief-brand-note", "Mostly LinkedIn");
    await act(async () => {
      container
        .querySelector("#brief-brand-note")
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
    });
    expect(
      container.querySelector<HTMLInputElement>("#brief-brand-note")?.value,
    ).toBe("Mostly LinkedIn");
  });

  it("clears a refusal once the chat moves on", async () => {
    const answer = (count: number) =>
      asking({
        brandBrain: {
          ...brain,
          questions: (brain.questions ?? []).map((question, index) =>
            index < count ? { ...question, answer: "no" as const } : question,
          ),
        },
      });
    const answers = [answer(1), answer(2)];
    const overview = answer(0);
    await render(
      overview,
      actionsFor(overview, {
        answerBrandQuestion: async () => answers.shift() ?? answer(2),
        fixBrandSection: async () => "You're out of credits.",
      }),
    );
    await press("No");
    expect(text()).toContain("You're out of credits.");
    await press("Yes");
    expect(container.querySelector("[data-brief-question]")?.textContent).toBe(
      "Did I get Acme right?",
    );
    expect(text()).not.toContain("You're out of credits.");
  });
});

describe("brand check", () => {
  const checked = (patch: Partial<CmoOverview> = {}) =>
    asking({ brandBrain: { ...brain, questions: [] }, ...patch });

  it("confirms the brand, then asks for the plan when nothing writes it", async () => {
    const approveBrandBrain = vi.fn(async () => draft({ strategy: null }));
    const requestStrategy = vi.fn(async () => ({
      overview: null,
      error: null,
    }));
    const overview = checked();
    await render(
      overview,
      actionsFor(overview, { approveBrandBrain, requestStrategy }),
    );
    await press("Looks like us");
    expect(approveBrandBrain).toHaveBeenCalled();
    expect(requestStrategy).toHaveBeenCalledWith();
  });

  it("confirms without a second plan while one writes, or once one is written", async () => {
    for (const overview of [
      checked({ work: work("strategy") }),
      checked({ strategy }),
    ]) {
      const requestStrategy = vi.fn(async () => ({
        overview: null,
        error: null,
      }));
      await render(
        overview,
        actionsFor(overview, {
          approveBrandBrain: async () => overview,
          requestStrategy,
        }),
      );
      await press("Looks like us");
      expect(requestStrategy).not.toHaveBeenCalled();
    }
  });

  it("fixes the brand in words alone: a reply, not a form", async () => {
    const fixBrandSection = vi.fn(async () => null);
    const overview = checked();
    await render(overview, actionsFor(overview, { fixBrandSection }));
    await press("Fix something");
    expect(document.activeElement?.id).toBe("brief-fix-note");
    expect(text()).not.toContain("Which part?");
    typeInto("#brief-fix-note", "We sell to agencies too");
    await press("Send");
    expect(fixBrandSection).toHaveBeenCalledWith(
      null,
      "We sell to agencies too",
    );
    expect(text()).toContain("Fix something: We sell to agencies too");
    expect(text()).toContain(
      "Got it. I'm fixing your Brand Brain now, and your plan picks it up. Anything else?",
    );
    expect(button("That's all, looks like us")).toBeTruthy();
    expect(button("One more fix")).toBeTruthy();
  });

  it("shows a general fix as being fixed until Cuso has rewritten it", async () => {
    const fixing = (fixed: boolean) =>
      checked({
        brandBrain: {
          ...brain,
          questions: [],
          fix: { note: "We sell to agencies too", at: "2026-11-13", fixed },
        },
      });
    await render(fixing(false));
    expect(text()).toContain("Your correction · being fixed");
    expect(text()).toContain("We sell to agencies too");
    expect(text()).toContain("Cuso is fixing this");

    await act(async () => root.unmount());
    root = createRoot(container);
    await render(fixing(true));
    expect(text()).not.toContain("being fixed");
  });
});

describe("briefing", () => {
  it("walks the plan, week one, the checks and the ads, one step each", async () => {
    const answerPlanQuestion = vi.fn(async () => draft({ strategy: fullPlan }));
    const setAdBudget = vi.fn(async () => ({ overview: null, error: null }));
    const overview = draft({ strategy: fullPlan });
    await render(
      overview,
      actionsFor(overview, { answerPlanQuestion, setAdBudget }),
    );

    expect(text()).toContain("briefing 1 of 4");
    expect(container.querySelector("[data-brief-question]")?.textContent).toBe(
      "Your briefing is ready. Does this plan sound right?",
    );
    await press("Sounds right");

    expect(text()).toContain("briefing 2 of 4");
    expect(text()).toContain("Week one has 2 pieces");
    await press("Keep 2");

    expect(text()).toContain("question 1 of 2");
    await press("Yes");
    expect(answerPlanQuestion).toHaveBeenCalledWith({
      questionId: "pq1",
      answer: "yes",
      note: undefined,
    });
    // Later on the checks leaves them for now and moves on.
    await press("Later");
    expect(text()).toContain("briefing 4 of 4");
    expect(text()).toContain("Spend $300 a month on Google?");
    await press("No ads");
    expect(setAdBudget).toHaveBeenCalledWith(0, "USD");
  });

  it("grounds each move in its reason and the Brand Brain section it rests on", async () => {
    const grounded = draft({
      strategy: {
        ...fullPlan,
        funnel: [
          {
            stage: "awareness",
            name: "Hear about us",
            goal: "Show a rocket at work on X, every day",
            channels: ["x"],
            metric: "Profile visits",
            plays: [{ channel: "x", what: "Daily launch clips" }],
            why: "Buyers trust what they see done.",
            basedOn: ["customers", "opportunities"],
          },
          {
            stage: "consideration",
            name: "Look closer",
            goal: "Compare launch kits honestly",
            channels: ["seo"],
            metric: "Site visits",
            plays: [{ channel: "seo", what: "Comparison articles" }],
          },
        ],
      },
      brandBrain: {
        ...brain,
        profile: {
          customers: {
            answer: "Product teams of ten to fifty.",
            findings: [],
            openQuestions: [],
          },
        },
      },
    });
    await render(grounded);
    expect(text()).toContain("Buyers trust what they see done.");
    // A move without a reason keeps its first play instead.
    expect(text()).toContain("Comparison articles");
    // A section the Brand Brain never saved is no source.
    expect(text()).not.toContain("Constraints and opportunities");
    const source = button("Brand Brain · Target customers");
    expect(source.getAttribute("aria-expanded")).toBe("false");
    await act(async () => source.click());
    expect(source.getAttribute("aria-expanded")).toBe("true");
    expect(text()).toContain("Product teams of ten to fifty.");
  });

  it("remembers the steps gone through on this device", async () => {
    const overview = draft({ strategy: fullPlan });
    await render(overview);
    await press("Sounds right");
    expect(
      JSON.parse(window.localStorage.getItem("cmo-briefed-project-1") ?? "[]"),
    ).toEqual(["plan"]);
  });

  it("sends a change in words as a patch, and says it is changing", async () => {
    const requestStrategy = vi.fn(async () => ({
      overview: draft({
        strategy: fullPlan,
        work: work("strategy", { change: "patch", steps: [] }),
      }),
      error: null,
    }));
    const overview = draft({ strategy: fullPlan });
    await render(overview, actionsFor(overview, { requestStrategy }));
    typeInto("#brief-plan-note", "Sign-ups before 1 Dec");
    await press("Send");
    expect(requestStrategy).toHaveBeenCalledWith("Sign-ups before 1 Dec", true);
    expect(text()).toContain("Changing: Sign-ups before 1 Dec");
    expect(text()).toContain("Your next question waits until this lands.");
  });

  it("writes a tapped piece of week one into the chat's field", async () => {
    await render(draft({ strategy: fullPlan }), undefined, {
      briefed: ["plan"],
    });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("button.brief-week-row")
        ?.click(),
    );
    expect(
      container.querySelector<HTMLInputElement>("#brief-plan-note")?.value,
    ).toBe("Change “Why we built it”: ");
  });

  it("shows the piece a check changes, else what a yes keeps", async () => {
    const withPiece = draft({
      strategy: {
        ...fullPlan,
        questions: [{ ...firstCheck, entryIds: ["b"] }, secondCheck],
      },
    });
    await render(withPiece, undefined, { briefed: ["plan", "pace"] });
    expect(text()).toContain("The piece this question changes");
    expect(text()).toContain("Launch day");
    expect(text()).toContain("See more: week one");

    await act(async () => root.unmount());
    root = createRoot(container);
    await render(draft({ strategy: fullPlan }), undefined, {
      briefed: ["plan", "pace"],
    });
    expect(text()).toContain("What a yes keeps in the plan");
    expect(text()).toContain("They ship monthly.");
  });

  it("fits the plan to the nos once the last check is answered", async () => {
    const answered: Strategy = {
      ...fullPlan,
      questions: [
        { ...firstCheck, answer: "yes" },
        { ...secondCheck, answer: "no", note: "No" },
      ],
    };
    const answerPlanQuestion = vi.fn(async () => draft({ strategy: answered }));
    const applyPlanAnswers = vi.fn(async () => ({
      overview: null,
      error: null,
    }));
    const overview = draft({
      strategy: {
        ...fullPlan,
        questions: [{ ...firstCheck, answer: "yes" }, secondCheck],
      },
    });
    await render(
      overview,
      actionsFor(overview, { answerPlanQuestion, applyPlanAnswers }),
      { briefed: ["plan", "pace"] },
    );
    await press("No");
    expect(applyPlanAnswers).toHaveBeenCalled();
  });

  it("approves the month, and tells a member who cannot who does", async () => {
    const approveStrategy = vi.fn(async () =>
      draft({ ...cmoStrategyVersion(new Date()), strategy }),
    );
    const overview = draft();
    await render(overview, actionsFor(overview, { approveStrategy }), {
      briefed: ["plan", "pace"],
    });
    expect(text()).toContain("Your month, in one table");
    // Approval is Go live's: Briefing is done and its steps are gone.
    expect(
      container.querySelector('.brief-timeline [aria-current="step"]')
        ?.textContent,
    ).toContain("6 Go live");
    expect(container.querySelector(".brief-steps-row")).toBeNull();
    await press("Approve plan");
    expect(approveStrategy).toHaveBeenCalled();
    expect(text()).toContain("Connect at least one place week one posts to.");

    await act(async () => root.unmount());
    root = createRoot(container);
    await render(draft({ viewerCanApprove: false }), undefined, {
      briefed: ["plan", "pace"],
    });
    expect(text()).toContain("Only an owner or admin");
    expect(() => button("Approve plan")).toThrow();
  });
});

describe("go live", () => {
  const approved = () => draft(cmoStrategyVersion(new Date()));
  const linkedIn = {
    id: "li",
    provider: "linkedin",
    handle: "acme",
    displayName: "Acme",
    status: "ACTIVE",
  };

  /** A popup window as `window.open` hands it back. */
  function popupWindow() {
    return { location: { href: "" }, closed: false, close: vi.fn() };
  }

  const done = (result: string, origin = window.location.origin) =>
    act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin,
          data: { type: "cmo-connect-done", result },
        }),
      );
    });

  async function renderLaunch(
    connectChannel: OnboardingActions["connectChannel"] = vi.fn(async () => ({
      url: "https://connect.example/linkedin",
      error: null,
    })),
  ) {
    const loadState = vi.fn(async () => ({
      overview: approved(),
      messages: [],
    }));
    const overview = approved();
    await render(overview, actionsFor(overview, { connectChannel, loadState }));
    return { connectChannel, loadState };
  }

  it("connects in a popup, then offers Launch without a reload", async () => {
    const popup = popupWindow();
    const open = vi.fn(() => popup);
    vi.stubGlobal("open", open);
    const { connectChannel, loadState } = await renderLaunch();
    expect(text()).toContain("Where your month posts");

    await press("Connect LinkedIn");

    // Opened in the click itself, so a popup blocker lets it through.
    expect(open).toHaveBeenCalledTimes(1);
    expect(connectChannel).toHaveBeenCalledWith("linkedin", "popup");
    expect(popup.location.href).toBe("https://connect.example/linkedin");
    expect(assign).not.toHaveBeenCalled();

    loadState.mockImplementation(async () => ({
      overview: draft({
        ...cmoStrategyVersion(new Date()),
        channels: [linkedIn],
      }),
      messages: [],
    }));
    await done("connected");

    expect(text()).toContain("LinkedIn is connected. Launch now?");
    expect(text()).toContain("X pieces wait as drafts");
  });

  it("ignores a done message from another origin", async () => {
    vi.stubGlobal("open", () => popupWindow());
    const { loadState } = await renderLaunch();
    await press("Connect LinkedIn");
    loadState.mockClear();
    await done("connected", "https://evil.example");
    expect(loadState).not.toHaveBeenCalled();
  });

  it("says so when the popup's connect did not finish", async () => {
    vi.stubGlobal("open", () => popupWindow());
    await renderLaunch();
    await press("Connect LinkedIn");
    await done("failed");
    expect(text()).toContain("That connection didn't finish. Try again.");
    expect(button("Connect LinkedIn").disabled).toBe(false);
  });

  it("checks again once the founder closes the popup without finishing", async () => {
    vi.useFakeTimers();
    const popup = popupWindow();
    vi.stubGlobal("open", () => popup);
    const { loadState } = await renderLaunch();
    await press("Connect LinkedIn");
    loadState.mockClear();
    popup.closed = true;
    await act(async () => vi.advanceTimersByTime(600));
    expect(loadState).toHaveBeenCalled();
    expect(button("Connect LinkedIn").disabled).toBe(false);
  });

  it("closes the popup when connecting cannot start", async () => {
    const popup = popupWindow();
    vi.stubGlobal("open", () => popup);
    await renderLaunch(async () => ({
      url: null,
      error: "Could not start connecting",
    }));
    await press("Connect LinkedIn");
    expect(popup.close).toHaveBeenCalled();
    expect(text()).toContain("Could not start connecting");
  });

  it("falls back to today's redirect when popups are blocked", async () => {
    vi.stubGlobal("open", () => null);
    const { connectChannel } = await renderLaunch();
    await press("Connect LinkedIn");
    expect(connectChannel).toHaveBeenCalledWith("linkedin", "onboarding");
    expect(assign).toHaveBeenCalledWith("https://connect.example/linkedin");
  });

  it("launches into Your month, and Go to Today leaves for the app", async () => {
    const finishAccounts = vi.fn(() => new Promise<never>(() => {}));
    const overview = draft({
      ...cmoStrategyVersion(new Date()),
      channels: [linkedIn],
    });
    await render(overview, actionsFor(overview, { finishAccounts }));
    await press("Launch");
    expect(text()).toContain("You're live");
    expect(text()).toContain(
      "Onboarding is done. I keep making your month in the background.",
    );
    expect(document.title).toBe("CMO.xyz");
    await press("Go to Today");
    expect(finishAccounts).toHaveBeenCalled();
  });
});

describe("waiting and coming back", () => {
  it("offers Try again when the read stopped, keeping what was saved", async () => {
    const retryLearning = vi.fn(async () => ({
      overview: reading(),
      error: null,
    }));
    const overview = reading({
      learning: "failed",
      work: work("research", { status: "failed", sectionsSaved: 9 }),
    });
    await render(overview, actionsFor(overview, { retryLearning }));
    expect(text()).toContain("I stopped before I finished reading. Try again?");
    expect(text()).toContain("I keep the 9 sections I saved");
    await press("Try again");
    expect(retryLearning).toHaveBeenCalled();
  });

  it("answers Cuso in words when the read ended with a question", async () => {
    const sendMessage = vi.fn(async () => {});
    const overview = reading({
      learning: "done",
      work: work("research", { status: "done" }),
    });
    await act(async () =>
      root.render(
        <OnboardingFlow
          overview={overview}
          messages={[
            {
              id: "m1",
              fromCuso: true,
              author: "Cuso",
              content: "Which product should this month sell?",
              createdAt: "2026-11-13T09:00:00Z",
            },
          ]}
          actions={actionsFor(overview, { sendMessage })}
        />,
      ),
    );
    expect(container.querySelector("[data-brief-question]")?.textContent).toBe(
      "Which product should this month sell?",
    );
    typeInto("#brief-reply", "The rockets");
    await press("Send");
    expect(sendMessage).toHaveBeenCalledWith("The rockets");
  });

  it("welcomes the person back with what waits, once Cuso moved on", async () => {
    window.localStorage.setItem("cmo-seen-project-1", "research");
    const overview = asking();
    await act(async () =>
      root.render(
        <OnboardingFlow
          overview={overview}
          messages={[]}
          actions={actionsFor(overview)}
        />,
      ),
    );
    expect(text()).toContain("Welcome back. 3 quick things need you.");
    expect(text()).toContain("While you were away");
    await press("Start");
    expect(container.querySelector("[data-brief-question]")?.textContent).toBe(
      "Do most customers find you through Google?",
    );
  });

  it("does not welcome back on a reload where the person left off", async () => {
    window.localStorage.setItem("cmo-seen-project-1", "brand");
    const overview = asking();
    await act(async () =>
      root.render(
        <OnboardingFlow
          overview={overview}
          messages={[]}
          actions={actionsFor(overview)}
        />,
      ),
    );
    expect(text()).not.toContain("Welcome back");
  });
});

describe("looking back along the bar", () => {
  const stageButton = (label: string) => {
    const found = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".brief-timeline button",
      ),
    ].find((element) => element.textContent?.includes(label));
    if (!found) throw new Error(`No stage "${label}"`);
    return found;
  };
  const question = () =>
    container.querySelector("[data-brief-question]")?.textContent;
  const page = () => container.querySelector(".brief-main")?.textContent ?? "";

  it("makes finished stages and the current one buttons, and the ones ahead disabled", async () => {
    await render(draft({ strategy: fullPlan }));
    for (const label of ["Website", "Research", "Brand check", "Plan"]) {
      expect(stageButton(label).disabled).toBe(false);
    }
    const now = stageButton("Briefing");
    expect(now.disabled).toBe(false);
    expect(now.getAttribute("aria-current")).toBe("step");
    for (const label of ["Go live", "Your month"]) {
      expect(stageButton(label).disabled).toBe(true);
      expect(stageButton(label).getAttribute("aria-disabled")).toBe("true");
    }
  });

  it("shows a finished stage read-only, marks it viewed, and goes back", async () => {
    await render(draft({ strategy: fullPlan }));
    await act(async () => stageButton("Research").click());

    expect(page()).toContain("Back to Briefing");
    expect(page()).toContain("What I learned about acme.io");
    expect(page()).toContain("Acme sells rockets. Founders buy them.");
    // Review mode changes nothing: no fields on the page.
    expect(
      container.querySelector(".brief-main input, .brief-main textarea"),
    ).toBeNull();
    const viewed = stageButton("Research");
    expect(viewed.className).toContain("viewed");
    expect(viewed.textContent).toContain("viewing");
    // Progress stays where it is.
    expect(stageButton("Briefing").getAttribute("aria-current")).toBe("step");
    // The chat keeps asking the current question.
    expect(question()).toBe(
      "Your briefing is ready. Does this plan sound right?",
    );

    await press("Back to Briefing");
    expect(page()).not.toContain("Back to Briefing");
    expect(stageButton("Research").className).not.toContain("viewed");
  });

  it("shows the plan's goal and moves, and the current stage takes you back", async () => {
    await render(draft({ strategy: fullPlan }), undefined, {
      briefed: ["plan", "pace"],
    });
    await act(async () => stageButton("Plan").click());
    expect(page()).toContain("Back to Briefing");
    expect(page()).toContain("Goal");
    expect(question()).toBe("Do you ship every month?");

    await act(async () => stageButton("Briefing").click());
    expect(page()).not.toContain("Back to Briefing");
  });

  it("shows the briefing's answers once it is done", async () => {
    const answered = draft({
      strategy: {
        ...fullPlan,
        questions: [{ ...firstCheck, answer: "yes" }, secondCheck],
      },
    });
    await render(answered, undefined, {
      briefed: ["plan", "pace", "checks", "ads"],
    });
    await act(async () => stageButton("Briefing").click());
    expect(page()).toContain("Back to Go live");
    expect(page()).toContain("Your answers");
    expect(page()).toContain("Do you ship every month? Yes");
  });

  it("stays on the stage looked at when the current one finishes", async () => {
    const setAdBudget = vi.fn(async () => ({ overview: null, error: null }));
    const overview = draft({ strategy: fullPlan });
    await render(overview, actionsFor(overview, { setAdBudget }), {
      briefed: ["plan", "pace", "checks"],
    });
    await act(async () => stageButton("Research").click());
    await press("No ads");

    expect(stageButton("Go live").getAttribute("aria-current")).toBe("step");
    expect(page()).toContain("What I learned about acme.io");
    expect(page()).toContain("Back to Go live");
  });

  it("opens a sheet of the stages on a phone, picks one and closes", async () => {
    await render(draft({ strategy: fullPlan }));
    const fold = container.querySelector<HTMLButtonElement>(
      "button.brief-fold-button",
    );
    expect(fold?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => fold?.click());

    const sheet = container.querySelector('[role="dialog"]');
    expect(sheet?.getAttribute("aria-label")).toBe("Your progress");
    const rows = [...(sheet?.querySelectorAll("li") ?? [])];
    expect(rows).toHaveLength(7);
    expect(rows[1]?.textContent).toContain("Research");
    expect(rows[1]?.textContent).toContain("Cuso");
    expect(rows[1]?.textContent).toContain("Done");
    expect(rows[4]?.textContent).toContain("Now");
    expect(rows[5]?.textContent).toContain("Later");
    expect(rows[5]?.querySelector("button")?.disabled).toBe(true);

    await act(async () => rows[1]?.querySelector("button")?.click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(page()).toContain("Back to Briefing");
    expect(container.querySelector(".brief-fold")?.textContent).toContain(
      "Viewing: Research",
    );

    // Esc closes it, and focus goes back to the step line.
    await act(async () => fold?.click());
    await act(async () => {
      container
        .querySelector('[role="dialog"]')
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(fold);
    // The chat never moved.
    expect(question()).toBe(
      "Your briefing is ready. Does this plan sound right?",
    );
  });

  it("keeps Tab inside the phone sheet and holds the page still while it's open", async () => {
    await render(draft({ strategy: fullPlan }));
    const fold = container.querySelector<HTMLButtonElement>(
      "button.brief-fold-button",
    );
    await act(async () => fold?.click());
    expect(document.body.style.overflow).toBe("hidden");

    const sheet = container.querySelector<HTMLElement>('[role="dialog"]');
    const live = [
      ...(sheet?.querySelectorAll<HTMLButtonElement>("button") ?? []),
    ].filter((button) => !button.disabled);
    const first = live[0];
    const last = live.at(-1);
    expect(first?.getAttribute("aria-label")).toBe("Close");
    expect(last?.textContent).toContain("Briefing");
    const tab = (shiftKey: boolean) =>
      act(async () => {
        document.activeElement?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true }),
        );
      });

    last?.focus();
    await tab(false);
    expect(document.activeElement).toBe(first);
    await tab(true);
    expect(document.activeElement).toBe(last);

    await act(async () => first?.click());
    expect(document.body.style.overflow).toBe("");
  });
});
