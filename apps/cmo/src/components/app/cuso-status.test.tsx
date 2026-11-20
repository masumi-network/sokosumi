import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { cmoOverview, cmoStrategyVersion } from "../../test-fixtures/cmo";
import { CusoStatus, cusoBubble } from "./cuso-status";

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
    <CusoStatus
      overview={cmoOverview(patch)}
      view="today"
      now={NOW}
      onOpen={() => {}}
    />,
  );
  expect(html).toContain(encodeURIComponent(`/cuso/${art}.png`));
  expect(html).toContain(`data-pose="${pose}"`);
  // His bubble always says the state in words; the drawing is decoration.
  expect(html).toContain('class="cuso-says"');
  expect(html).toMatch(/class="cuso-figure" aria-hidden="true"/);
  if (line) expect(html).toContain(line);
  // Working shows the working dot in his bubble.
  expect(html.includes("ob-box-dot")).toBe(
    pose === "reading" || pose === "thinking",
  );
});

const calm = cmoOverview({
  ...approved,
  channels: [channel],
  production: production({}),
});

it("points at the owner whenever something needs them, on every page", () => {
  const overview = cmoOverview();
  for (const view of ["chat", "calendar", "settings"] as const) {
    expect(cusoBubble(overview, view, NOW)).toMatchObject({
      art: "pointing",
      line: expect.stringMatching(/(One thing needs you|\d+ things need you)/),
    });
  }
});

it("speaks about the page while nothing needs the owner", () => {
  expect(cusoBubble(calm, "chat", NOW).line).toBe("I'm listening");
  expect(cusoBubble(calm, "strategy", NOW).line).toBe("This is how we win");
  expect(cusoBubble(calm, "today", NOW).line).toBe("On schedule");
  expect(cusoBubble(calm, "calendar", NOW).line).toBe("1 post is scheduled");
  // A page with nothing of its own to say keeps his state.
  const nothingOut = cmoOverview({
    ...approved,
    channels: [channel],
    production: production({}),
    posts: { draft: 0, scheduled: 0, published: 0, failed: 0 },
  });
  expect(cusoBubble(nothingOut, "calendar", NOW).line).toBe("On schedule");
});

it("keeps saying what he makes while he works, whatever the page", () => {
  const making = cmoOverview({
    ...approved,
    channels: [channel],
    production: production({ state: "running", ready: 8 }),
  });
  expect(cusoBubble(making, "chat", NOW)).toMatchObject({
    art: "thinking",
    line: "8 of 11 made",
  });
});

it("opens Today from every page but Today itself", () => {
  const away = renderToStaticMarkup(
    <CusoStatus overview={calm} view="chat" now={NOW} onOpen={() => {}} />,
  );
  expect(away).toContain('<button type="button" class="cuso-says"');
  expect(away).toContain("Open Today");
  const home = renderToStaticMarkup(
    <CusoStatus overview={calm} view="today" now={NOW} onOpen={() => {}} />,
  );
  expect(home).not.toContain("<button");
  expect(home).toContain("On schedule");
});
