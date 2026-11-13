import { describe, expect, it } from "vitest";

import { cmoStrategyVersion } from "../../test-fixtures/cmo";
import {
  asking,
  draft,
  reading,
  research,
  strategy,
  work,
} from "../../test-fixtures/onboarding";
import {
  type BriefLocal,
  briefAsks,
  briefStage,
  briefSteps,
  questionEntry,
  stageMarks,
  weekOne,
  workingStatus,
} from "./brief";

const local = (patch: Partial<BriefLocal> = {}): BriefLocal => ({
  briefed: [],
  skipped: [],
  launched: false,
  askedInWords: false,
  slow: "none",
  ...patch,
});

const approved = cmoStrategyVersion(new Date("2026-10-05T09:10:00Z"));
const kinds = (asks: { kind: string }[]) => asks.map((ask) => ask.kind);
const briefed = local({ briefed: ["plan", "pace", "ads"] });

describe("briefStage", () => {
  it("reads while there is no Brand Brain, even once the read stopped", () => {
    expect(briefStage(reading(), local())).toBe("research");
    expect(
      briefStage(
        reading({ work: work("research", { status: "failed" }) }),
        local(),
      ),
    ).toBe("research");
  });

  it("stays on research while the read runs with the essentials in", () => {
    expect(briefStage(asking({ work: work("research") }), local())).toBe(
      "research",
    );
  });

  it("is the brand check once the read is done, even while the plan writes", () => {
    expect(briefStage(asking(), local())).toBe("brand");
    expect(briefStage(asking({ work: work("strategy") }), local())).toBe(
      "brand",
    );
  });

  it("is the plan once the brand is confirmed and the plan writes", () => {
    expect(
      briefStage(draft({ strategy: null, work: work("strategy") }), local()),
    ).toBe("plan");
    // The plan part landed, the calendar is still being written.
    expect(
      briefStage(
        draft({
          strategy: { ...strategy, calendar: [] },
          work: work("strategy"),
        }),
        local(),
      ),
    ).toBe("plan");
  });

  it("is the briefing once the plan is written, also while a patch runs", () => {
    expect(briefStage(draft(), local())).toBe("briefing");
    expect(
      briefStage(
        draft({ work: work("strategy", { change: "patch" }) }),
        local(),
      ),
    ).toBe("briefing");
  });

  it("asks for the approval on Go live once the briefing is done", () => {
    const done = local({ briefed: ["plan", "pace"] });
    expect(briefStage(draft(), local())).toBe("briefing");
    expect(briefStage(draft(), done)).toBe("golive");
    expect(
      stageMarks(draft(), done).map((mark) => [mark.id, mark.state]),
    ).toEqual([
      ["website", "done"],
      ["research", "done"],
      ["brand", "done"],
      ["plan", "done"],
      ["briefing", "done"],
      ["golive", "now"],
      ["month", "next"],
    ]);
    expect(briefAsks(draft(), done)).toEqual([
      { kind: "approve", canApprove: true },
    ]);
    // A change on its way holds the approval until it lands.
    expect(
      briefAsks(
        draft({ work: work("strategy", { change: "patch", steps: [] }) }),
        done,
      ),
    ).toEqual([]);
  });

  it("goes straight to Go live for a newer draft after an approval, unless a no needs fitting", () => {
    expect(briefStage(draft({ approvedStrategy: strategy }), local())).toBe(
      "golive",
    );
    const unfitted = {
      ...strategy,
      changes: [],
      questions: [
        {
          id: "pq",
          question: "Ship monthly?",
          statement: "They ship.",
          answer: "no" as const,
        },
      ],
    };
    expect(
      briefStage(
        draft({ strategy: unfitted, approvedStrategy: strategy }),
        local(),
      ),
    ).toBe("briefing");
  });

  it("goes live once approved, and is the month once launched", () => {
    expect(briefStage(draft(approved), local())).toBe("golive");
    expect(briefStage(draft(approved), local({ launched: true }))).toBe(
      "month",
    );
  });
});

describe("stageMarks", () => {
  it("marks done stages, the current one and the plan writing behind the brand check", () => {
    const marks = stageMarks(asking({ work: work("strategy") }), local());
    expect(marks.map((mark) => mark.state)).toEqual([
      "done",
      "done",
      "now",
      "background",
      "next",
      "next",
      "next",
    ]);
  });

  it("marks a plan written before the brand check as done", () => {
    const marks = stageMarks(asking({ strategy }), local());
    expect(marks.map((mark) => mark.state)).toEqual([
      "done",
      "done",
      "now",
      "done",
      "next",
      "next",
      "next",
    ]);
  });
});

describe("briefAsks", () => {
  it("asks nothing while Cuso reads", () => {
    expect(briefAsks(reading(), local())).toEqual([]);
  });

  it("asks the brand questions with a count, then the brand check", () => {
    const asks = briefAsks(asking(), local());
    expect(kinds(asks)).toEqual([
      "brand-question",
      "brand-question",
      "brand-check",
    ]);
    expect(asks[1]).toMatchObject({ index: 1, total: 2 });
  });

  it("asks the brand questions while the read finishes, not yet the check", () => {
    expect(
      kinds(briefAsks(asking({ work: work("research") }), local())),
    ).toEqual(["brand-question", "brand-question"]);
  });

  it("leaves skipped brand questions out", () => {
    expect(
      kinds(briefAsks(asking(), local({ skipped: ["questions"] }))),
    ).toEqual(["brand-check"]);
  });

  it("offers Try again when the read stopped, and the reply when Cuso asked in words", () => {
    const failed = reading({ work: work("research", { status: "failed" }) });
    expect(kinds(briefAsks(failed, local()))).toEqual(["research-retry"]);
    expect(kinds(briefAsks(failed, local({ askedInWords: true })))).toEqual([
      "research-reply",
    ]);
  });

  it("offers Try again on a read past twice the usual time", () => {
    expect(kinds(briefAsks(reading(), local({ slow: "stuck" })))).toEqual([
      "research-retry",
    ]);
  });

  it("walks the briefing in order, one step at a time", () => {
    const plan = {
      ...strategy,
      pace: { level: "all_in" as const, why: "Fast", perWeek: 15 },
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
          id: "ad",
          date: "2026-10-13",
          channel: "google_ads",
          title: "AI coworkers",
          format: "ad",
          status: "idea" as const,
        },
      ],
      questions: [
        {
          id: "pq1",
          question: "Can I quote Florian?",
          statement: "Florian may be quoted",
        },
      ],
    };
    const overview = draft({ strategy: plan });
    expect(kinds(briefAsks(overview, local()))).toEqual([
      "briefing-plan",
      "briefing-week",
      "plan-question",
      "briefing-ads",
      "approve",
    ]);
    expect(
      kinds(briefAsks(overview, local({ briefed: ["plan", "pace"] }))),
    ).toEqual(["plan-question", "briefing-ads", "approve"]);
    expect(briefSteps(overview)).toEqual(["plan", "week", "checks", "ads"]);
  });

  it("skips the whole briefing on any device once a plan was approved", () => {
    const plan = {
      ...strategy,
      pace: { level: "active" as const, why: "One a day", perWeek: 7 },
      questions: [
        { id: "pq1", question: "Ship monthly?", statement: "They ship." },
      ],
    };
    // A device with nothing briefed, after approval: Go live, no briefing.
    expect(
      kinds(
        briefAsks(
          draft({ ...approved, strategy: plan, approvedStrategy: plan }),
          local(),
        ),
      ),
    ).toEqual(["connect"]);
    // A newer draft waits for approval: only the approval is asked again.
    expect(
      briefAsks(draft({ strategy: plan, approvedStrategy: plan }), local()),
    ).toEqual([{ kind: "approve", canApprove: true }]);
    // Unless a no on it is not fitted yet: that patch comes first.
    const unfitted = {
      ...plan,
      changes: [],
      questions: [{ ...plan.questions[0]!, answer: "no" as const }],
    };
    expect(
      kinds(
        briefAsks(
          draft({ strategy: unfitted, approvedStrategy: plan }),
          local(),
        ),
      ),
    ).toEqual(["plan-apply"]);
  });

  it("skips the ads step for a plan without ads", () => {
    expect(briefSteps(draft())).toEqual(["plan", "week"]);
    expect(kinds(briefAsks(draft(), briefed))).toEqual(["approve"]);
  });

  it("holds the briefing while a patch or the whole plan runs", () => {
    expect(
      briefAsks(
        draft({ work: work("strategy", { change: "patch" }) }),
        local(),
      ),
    ).toEqual([]);
  });

  it("fits the plan to the nos once every check is answered", () => {
    const plan = {
      ...strategy,
      changes: [],
      questions: [
        {
          id: "pq1",
          question: "Can I quote Florian?",
          statement: "Florian may be quoted",
          answer: "no" as const,
        },
      ],
    };
    expect(kinds(briefAsks(draft({ strategy: plan }), briefed))).toEqual([
      "plan-apply",
    ]);
  });

  it("asks for the approval, and an owner or admin only can give it", () => {
    expect(briefAsks(draft(), briefed)).toEqual([
      { kind: "approve", canApprove: true },
    ]);
    expect(briefAsks(draft({ viewerCanApprove: false }), briefed)).toEqual([
      { kind: "approve", canApprove: false },
    ]);
  });

  it("asks to connect once approved, and nothing after Launch", () => {
    expect(kinds(briefAsks(draft(approved), local()))).toEqual(["connect"]);
    expect(briefAsks(draft(approved), local({ launched: true }))).toEqual([]);
  });

  it("offers Try again when the first plan stopped before its calendar", () => {
    expect(
      kinds(
        briefAsks(
          draft({
            strategy: { ...strategy, calendar: [], changes: [] },
            work: work("strategy", { status: "failed" }),
          }),
          local(),
        ),
      ),
    ).toEqual(["plan-retry"]);
  });
});

describe("workingStatus", () => {
  it("names the read and the page, and leaves the count to the groups", () => {
    const status = workingStatus(reading({ research: research(3) }), local());
    expect(status).toEqual({
      count: "",
      title: "Reading 6 places around your site",
      now: "Now: Reading acme.io/pricing",
      foot: "You can close this tab.",
    });
  });

  it("says it is slow without a number, and that nothing is lost", () => {
    const status = workingStatus(
      reading({ research: research(3) }),
      local({
        slow: "slow",
      }),
    );
    expect(status.title).toBe("Taking longer than usual");
    expect(status.foot).toBe(
      "Everything I've read is saved. You can still close this tab.",
    );
  });

  it("counts the pieces while the plan writes", () => {
    const status = workingStatus(
      draft({ work: work("strategy", { steps: [] }) }),
      local(),
    );
    expect(status.title).toBe("Writing your plan");
    expect(status.count).toBe("3 pieces so far");
    expect(status.now).toBe("");
    expect(status.foot).toBe("I'll ask when your briefing is ready.");
  });

  it("says a change is landing and the next question waits for it", () => {
    const status = workingStatus(
      draft({ work: work("strategy", { change: "patch", steps: [] }) }),
      local(),
    );
    expect(status.title).toBe("Changing your plan");
    expect(status.foot).toBe("Your next question waits until this lands.");
  });

  it("says the month goes on once live, with no count", () => {
    const status = workingStatus(
      draft({
        ...approved,
        production: {
          state: "running",
          ready: 10,
          total: 60,
          written: 22,
          pictured: 4,
          needPictures: 30,
          finishedAt: null,
          pillars: null,
        },
      }),
      local({ launched: true }),
    );
    expect(status.count).toBe("");
    expect(status.title).toBe("I keep making your month.");
  });
});

describe("questionEntry", () => {
  const ask = (entryIds?: string[]) => ({
    id: "pq",
    question: "Can I quote Lena?",
    statement: "Thursday quotes Lena.",
    ...(entryIds ? { entryIds } : {}),
  });

  it("is the first piece of the plan the question changes", () => {
    expect(questionEntry(strategy, ask(["gone", "b", "a"]))?.id).toBe("b");
  });

  it("is none for a question without pieces, or with none on the calendar", () => {
    expect(questionEntry(strategy, ask())).toBeNull();
    expect(questionEntry(strategy, ask(["gone"]))).toBeNull();
  });
});

describe("weekOne", () => {
  it("is the plan's first week of pieces, in order", () => {
    expect(weekOne(strategy.calendar).map((entry) => entry.id)).toEqual([
      "a",
      "b",
    ]);
  });
});
