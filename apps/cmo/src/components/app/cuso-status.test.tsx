import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { cmoOverview, cmoStrategyVersion } from "../../test-fixtures/cmo";
import { CusoStatus } from "./cuso-status";

const NOW = new Date("2026-11-05T12:00:00Z");
const approved = cmoStrategyVersion(new Date("2026-11-01T09:00:00Z"));
const channel = {
  id: "c1",
  provider: "linkedin",
  handle: "acme",
  displayName: "Acme",
  status: "ACTIVE",
};
const report = (at: string) => ({
  id: "u1",
  kind: "daily" as const,
  headline: "Scheduled two posts",
  at: new Date(at),
  revertible: false,
  revertedAt: null,
});
const production = (
  patch: Partial<ReturnType<typeof cmoOverview>["production"]>,
) => ({
  state: "ready" as const,
  ready: 11,
  total: 11,
  finishedAt: null,
  pillars: null,
  ...patch,
});

const cases = [
  {
    name: "researching reads",
    patch: { learning: "running" as const },
    pose: "reading",
    line: "Learning",
  },
  {
    name: "making the month thinks and counts",
    patch: {
      ...approved,
      channels: [channel],
      production: production({ state: "running", ready: 8 }),
    },
    pose: "thinking",
    line: "8 of 11 made",
  },
  {
    name: "a plan waiting for approval needs the owner",
    patch: {},
    pose: "needs-you",
    line: "Waiting for approval",
  },
  {
    name: "a fresh report shows reporting",
    patch: {
      ...approved,
      channels: [channel],
      production: production({}),
      updates: [report("2026-11-05T09:00:00Z")],
    },
    pose: "reporting",
    line: "Running",
  },
  {
    name: "idle is done",
    patch: {
      ...approved,
      channels: [channel],
      production: production({}),
      updates: [report("2026-11-01T09:00:00Z")],
    },
    pose: "done",
    line: "Running",
  },
];

it.each(cases)("Cuso's status card: $name", ({ patch, pose, line }) => {
  const html = renderToStaticMarkup(
    <CusoStatus overview={cmoOverview(patch)} now={NOW} />,
  );
  expect(html).toContain(`src="/cuso/${pose}.png"`);
  expect(html).toContain("Cuso");
  expect(html).toContain(line);
});
