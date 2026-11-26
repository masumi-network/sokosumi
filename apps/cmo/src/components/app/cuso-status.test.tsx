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
  withoutPicture: [],
  retryAt: null,
  writerFailed: false,
  floor: null,
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
    art: "researching",
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
    // The month's posts, as Today and the Calendar count them, not the
    // pieces Core's run still makes (8 of 11).
    line: "1 of 1 made",
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
    art: "friendly",
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
    art: "correct",
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
  expect(html).toContain(`data-art="${art}"`);
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
    line: "1 of 1 made",
  });
});

it("opens Today from a pill link on every page but Today itself", () => {
  const away = renderToStaticMarkup(
    <CusoStatus overview={calm} view="chat" now={NOW} onOpen={() => {}} />,
  );
  // A real link, so it opens in a new tab too and takes the focus ring.
  expect(away).toMatch(/<a class="cuso-says"[^>]*href="\/"/);
  expect(away).toContain("Open Today");
  expect(away).toContain('class="cuso-dot"');
  const home = renderToStaticMarkup(
    <CusoStatus overview={calm} view="today" now={NOW} onOpen={() => {}} />,
  );
  expect(home).not.toContain("<a ");
  expect(home).toContain("On schedule");
});

it("stands in his spotlight, the still of his pose until the rig is live", () => {
  const html = renderToStaticMarkup(
    <CusoStatus overview={calm} view="chat" now={NOW} onOpen={() => {}} />,
  );
  expect(html).toMatch(
    /<span class="cuso-figure" aria-hidden="true"><span class="cuso-ground"><\/span><span class="cuso-poses" data-art="[a-z]+"><span class="cuso-shadow"><\/span><img class="cuso-still"/,
  );
  // The brand guide's 2D drawing, never a PNG.
  expect(html).toContain(
    `src="/cuso/${cusoBubble(calm, "chat", NOW).art}.svg"`,
  );
  expect(html).not.toContain(".png");
});

it("looks things up on SEO and Competitors while nothing else goes on", () => {
  expect(cusoBubble(calm, "seo", NOW).art).toBe("researching");
  expect(cusoBubble(calm, "competitors", NOW).art).toBe("researching");
  expect(cusoBubble(calm, "chat", NOW).art).not.toBe("researching");
  // What needs the owner still comes first.
  expect(cusoBubble(cmoOverview(), "seo", NOW).art).toBe("pointing");
});

it("says the month stopped on every page, never a calm page line", () => {
  const stuck = cmoOverview({
    ...approved,
    channels: [channel],
    production: production({ state: "stuck", ready: 4 }),
  });
  for (const view of ["today", "calendar", "settings"] as const) {
    const line = cusoBubble(stuck, view, NOW).line;
    expect(line).toMatch(/^Stopped at \d+ of \d+$/);
  }
});

it("counts the month while the next run is about to start, not on schedule", () => {
  const starting = cmoOverview({
    ...approved,
    channels: [channel],
    production: production({ state: "starting", ready: 4 }),
  });
  expect(cusoBubble(starting, "today", NOW).line).toMatch(/^\d+ of \d+ made$/);
});
