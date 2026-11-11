import { describe, expect, it } from "vitest";

import { cmoOverview } from "../../test-fixtures/cmo";
import { asking, draft, reading, work } from "../../test-fixtures/onboarding";
import {
  liveLine,
  planWriting,
  QUIET_SECONDS,
  setupRows,
  slowCopy,
  stepTitle,
  USUAL_SECONDS,
} from "./live";

const MIN = 60;

describe("slow copy", () => {
  it("says the time so far against the usual time while on time", () => {
    expect(slowCopy(2 * MIN, 7 * MIN)).toEqual({
      line: "2 min so far, usually about 7 min",
      retry: false,
    });
    expect(slowCopy(12, 7 * MIN).line).toBe("12s so far, usually about 7 min");
  });

  it("says it is taking longer once past the usual time, still no retry", () => {
    expect(slowCopy(9 * MIN, 7 * MIN)).toEqual({
      line: "Taking longer than usual: 9 min so far, usually about 7 min",
      retry: false,
    });
  });

  it("holds Try again back while the work still moves, so nothing runs twice", () => {
    expect(slowCopy(14 * MIN, 7 * MIN, QUIET_SECONDS - 1)).toEqual({
      line: "Taking much longer than usual: 14 min so far, usually about 7 min. Still working.",
      retry: false,
    });
  });

  it("offers Try again from twice the usual time, once the work went quiet", () => {
    expect(slowCopy(14 * MIN, 7 * MIN, QUIET_SECONDS)).toEqual({
      line: "Taking much longer than usual: 14 min so far, usually about 7 min. Nothing is lost if you try again.",
      retry: true,
    });
    expect(slowCopy(14 * MIN - 1, 7 * MIN, QUIET_SECONDS).retry).toBe(false);
  });

  it("offers Try again from twice the usual time when Core can restart the run", () => {
    // Core replaces a slow run on Try again, so no quiet stretch is needed.
    expect(slowCopy(14 * MIN, 7 * MIN, 0, true)).toEqual({
      line: "Taking much longer than usual: 14 min so far, usually about 7 min. Nothing is lost if you try again.",
      retry: true,
    });
    expect(slowCopy(14 * MIN - 1, 7 * MIN, 0, true).retry).toBe(false);
  });

  it("never shows a percentage", () => {
    for (const seconds of [0, 30, 300, 900, 3_600]) {
      expect(slowCopy(seconds, USUAL_SECONDS.research).line).not.toMatch(/%/);
    }
  });
});

describe("live line", () => {
  it("says what Cuso is doing now from the work's latest step", () => {
    const overview = reading({
      work: {
        ...work("research"),
        steps: [
          ...work("research").steps,
          {
            id: "s2",
            kind: "read",
            label: "Reading acme.io/about",
            url: "https://acme.io/about",
            status: "running",
            at: new Date("2026-10-05T09:00:20Z"),
          },
        ],
      },
    });
    expect(liveLine(overview)?.label).toBe("Reading acme.io/about");
  });

  it("names the site before Core reports a step", () => {
    const overview = reading({ work: { ...work("research"), steps: [] } });
    expect(liveLine(overview)?.label).toBe("Reading acme.io");
  });

  it("is quiet once the work is done", () => {
    expect(liveLine(draft())).toBeNull();
    expect(
      liveLine(reading({ work: { ...work("research"), status: "done" } })),
    ).toBeNull();
  });
});

describe("plan writing", () => {
  it("is a whole plan, not a brand fix or a patch", () => {
    expect(planWriting(draft({ work: work("strategy") }))).toBe(true);
    expect(
      planWriting(draft({ work: work("strategy", { change: "fix" }) })),
    ).toBe(false);
    expect(
      planWriting(draft({ work: work("strategy", { change: "patch" }) })),
    ).toBe(false);
  });
});

describe("heading", () => {
  it("changes with the step", () => {
    expect(
      stepTitle({
        step: "site",
        overview: reading(),
        messages: [],
        phase: "reading",
        finished: false,
      }),
    ).toBe("Reading acme.io.");
    expect(stepTitle({ step: "brand", overview: asking() })).toBe(
      "Here's acme.io as I see it.",
    );
    expect(
      stepTitle({
        step: "plan",
        overview: draft(),
        phase: "planning",
        running: true,
      }),
    ).toBe("Writing your plan");
    expect(
      stepTitle({
        step: "plan",
        overview: draft(),
        phase: "review",
        running: false,
      }),
    ).toBe("Your first month.");
    expect(
      stepTitle({ step: "launch", overview: draft(), launched: true }),
    ).toBe("Cuso is live.");
  });

  it("asks for answers on Site while Cuso reads, once questions exist", () => {
    expect(
      stepTitle({
        step: "site",
        overview: asking({ work: work("research") }),
        messages: [],
        phase: "reading",
        finished: false,
      }),
    ).toBe("Reading acme.io. Answer a few while you wait.");
  });
});

describe("setup card", () => {
  it("lists what the hire created, from the overview only", () => {
    const overview = cmoOverview({
      businessName: "Fernhouse",
      projectName: "CMO.xyz · Fernhouse",
      billing: {
        plan: null,
        subscriptionStatus: null,
        availableCredits: 10_000,
      },
    });
    expect(setupRows(overview)).toEqual([
      'Organization "Fernhouse" and its workspace',
      "Starter credits, 10,000 left",
      'Project "CMO.xyz · Fernhouse"',
      "Cuso hired, with his own chat",
    ]);
  });

  it("leaves out credits when there are none", () => {
    const overview = cmoOverview({
      billing: { plan: null, subscriptionStatus: null, availableCredits: 0 },
    });
    expect(setupRows(overview).some((row) => row.includes("credits"))).toBe(
      false,
    );
  });
});
