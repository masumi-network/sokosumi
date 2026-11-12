import { describe, expect, it } from "vitest";

import { draft, reading, work } from "../../test-fixtures/onboarding";
import { liveLine, planWriting } from "./live";

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
