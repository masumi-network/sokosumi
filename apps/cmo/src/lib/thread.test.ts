import { expect, it } from "vitest";

import { cmoOverview, cmoStrategyVersion } from "../test-fixtures/cmo";
import { cusoPose, cusoStatus } from "./thread";

const NOW = new Date("2026-11-05T12:00:00Z");
const approved = cmoStrategyVersion(new Date("2026-11-01T09:00:00Z"));
const channel = {
  id: "c1",
  provider: "linkedin" as const,
  handle: "acme",
  displayName: "Acme",
  status: "ACTIVE" as const,
  personalProfile: false,
};

it("maps waiting states to needs-you and research to reading", () => {
  expect(cusoPose(cmoOverview(), NOW)).toBe("needs-you");
  expect(cusoPose(cmoOverview({ learning: "running" }), NOW)).toBe("reading");
});

it("reports for a day after a filed update once hired and running", () => {
  expect(
    cusoPose(
      cmoOverview({
        ...approved,
        channels: [channel],
        updates: [
          {
            id: "u1",
            kind: "daily",
            headline: "Scheduled two posts",
            at: new Date("2026-11-05T09:00:00Z"),
            revertible: false,
            revertedAt: null,
            posts: [],
            media: [],
          },
        ],
      }),
      NOW,
    ),
  ).toBe("reporting");
});

it("says it couldn't start when the month is blocked, not on schedule", () => {
  const hired = cmoOverview({ ...approved, channels: [channel] });
  expect(cusoStatus(hired)).toBe("On schedule");
  expect(
    cusoStatus({
      ...hired,
      production: { ...hired.production, state: "blocked" },
    }),
  ).toBe("Couldn't start");
});

it("says he is behind when the month stopped half made, not on schedule", () => {
  const hired = cmoOverview({ ...approved, channels: [channel] });
  expect(
    cusoStatus({
      ...hired,
      production: { ...hired.production, state: "stuck" },
    }),
  ).toBe("Behind");
});
