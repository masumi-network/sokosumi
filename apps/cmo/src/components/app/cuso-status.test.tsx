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
  ...patch,
});

const cases = [
  {
    name: "researching reads",
    patch: { learning: "running" as const },
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

it.each(cases)("Cuso's status card: $name", ({ patch, pose, art, line }) => {
  const html = renderToStaticMarkup(
    <CusoStatus overview={cmoOverview(patch)} now={NOW} />,
  );
  expect(html).toContain(`src="/cuso/${art}.png"`);
  expect(html).toContain("Cuso");
  // One line beside him always says the state, in words.
  expect(html).toContain("cuso-status-line");
  if (line) expect(html).toContain(line);
  // The big stage is gone from the sidebar: the pages keep the room.
  expect(html).not.toContain("ob-scene-compact");
  // Needs you calls out on Iris; working runs the bar under his line.
  expect(html.includes("cuso-status-call")).toBe(pose === "needs-you");
  expect(html.includes("ob-scene-bar")).toBe(
    pose === "reading" || pose === "thinking",
  );
});

it("is a focused button that opens the chat only while Cuso needs the owner", () => {
  const needs = renderToStaticMarkup(
    <CusoStatus overview={cmoOverview()} now={NOW} onOpen={() => {}} />,
  );
  expect(needs).toContain("<button");
  expect(needs).toContain("Waiting for approval");
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
});
