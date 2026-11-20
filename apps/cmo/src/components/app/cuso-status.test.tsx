import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { cmoOverview, cmoStrategyVersion } from "../../test-fixtures/cmo";
import { CusoStatus, cusoMood } from "./cuso-status";

const NOW = new Date("2026-11-05T12:00:00Z");
const approved = cmoStrategyVersion(new Date("2026-11-01T09:00:00Z"));
const channel = {
  id: "c1",
  provider: "linkedin",
  handle: "acme",
  displayName: "Acme",
  status: "ACTIVE",
  personalProfile: false,
};
const report = (at: string) => ({
  id: "u1",
  kind: "daily" as const,
  headline: "Scheduled two posts",
  at: new Date(at),
  revertible: false,
  revertedAt: null,
  posts: [],
  media: [],
});
const production = (
  patch: Partial<ReturnType<typeof cmoOverview>["production"]>,
) => ({
  state: "ready" as const,
  ready: 11,
  total: 11,
  written: 11,
  pictured: 0,
  needPictures: 0,
  finishedAt: null,
  pillars: null,
  level: "all_in" as const,
  beyondPlan: [],
  ...patch,
});

const cases = [
  {
    name: "researching reads",
    patch: {
      ...approved,
      channels: [channel],
      learning: "running" as const,
    },
    pose: "reading",
    art: "searching",
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
    art: "thinking",
    line: "8 of 11 made",
  },
  {
    name: "a plan waiting for approval needs the owner",
    patch: {},
    pose: "needs-you",
    art: "pointing",
    line: "need you",
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
    art: "walking",
    line: null,
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
    art: "thumbs-up",
    line: null,
  },
];

it.each(cases)("Cuso's status: $name", ({ patch, pose, art, line }) => {
  const html = renderToStaticMarkup(
    <CusoStatus overview={cmoOverview(patch)} now={NOW} />,
  );
  expect(html).toContain(`src="/cuso/${art}.png"`);
  expect(html).toContain(`data-pose="${pose}"`);
  // His bubble always says the state in words; the drawing is decoration.
  expect(html).toContain("cuso-says-line");
  expect(html).toMatch(/class="cuso-stage" aria-hidden="true"/);
  if (line) expect(html).toContain(line);
  // Working runs the bar under his line.
  expect(html.includes("ob-scene-bar")).toBe(
    pose === "reading" || pose === "thinking",
  );
});

it("points at the owner whenever something needs them, and his bubble opens Today", () => {
  const overview = cmoOverview();
  expect(cusoMood(overview, NOW)).toMatchObject({ art: "pointing" });
  const needs = renderToStaticMarkup(
    <CusoStatus overview={overview} now={NOW} onOpen={() => {}} />,
  );
  expect(needs).toContain(
    '<button type="button" class="cuso-says cuso-says-call"',
  );
  expect(needs).toMatch(/(One thing needs you|\d+ things need you)/);
  const calm = renderToStaticMarkup(
    <CusoStatus
      overview={cmoOverview({
        ...approved,
        channels: [channel],
        production: production({}),
      })}
      now={NOW}
      onOpen={() => {}}
    />,
  );
  expect(calm).not.toContain("<button");
  expect(calm).toContain("On schedule");
});
