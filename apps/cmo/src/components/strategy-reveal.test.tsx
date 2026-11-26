import type { CmoOverview } from "@sokosumi/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { cmoOverview } from "../test-fixtures/cmo";
import { PlanPanel } from "./onboarding/plan-tabs";
import { planPieces } from "./phone-feeds";
import { goalLine, pluralName } from "./strategy-reveal";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Entry = Strategy["calendar"][number];

const entry = (patch: Partial<Entry> & Pick<Entry, "id" | "date">): Entry => ({
  channel: "linkedin",
  title: "A post",
  format: "post",
  status: "idea",
  ...patch,
});

const calendar: Entry[] = [
  entry({ id: "a", date: "2026-10-27", time: "09:00", campaignId: "proof" }),
  entry({ id: "b", date: "2026-10-29", channel: "x", title: "On X" }),
  entry({
    id: "c",
    date: "2026-11-03",
    time: "08:00",
    title: "Second",
    format: "images",
  }),
  entry({ id: "d", date: "2026-11-04", status: "skipped" }),
  entry({
    id: "e",
    date: "2026-11-10",
    channel: "newsletter",
    format: "newsletter",
  }),
];

const strategy: Strategy = {
  month: "2026-11",
  summary: "Turn founders into trial sign-ups with weekly proof.",
  goals: ["35 trials by 23 Nov"],
  pillars: [{ name: "Setup proof", share: 100 }],
  channels: [
    { channel: "linkedin", cadence: "2 a week", why: "Where founders read" },
    { channel: "x", cadence: "1 a week" },
  ],
  calendar,
  barrier: {
    kind: "understanding",
    text: "Founders don't see how setup works",
  },
  funnel: [
    {
      stage: "awareness",
      name: "Hear about us",
      goal: "Founders see setup takes minutes",
      channels: ["linkedin", "x"],
      metric: "Profile visits",
    },
    {
      stage: "conversion",
      name: "Start a trial",
      goal: "Visitors start the 14-day trial",
      channels: ["newsletter"],
      metric: "Trial starts",
      target: "40 by 30 Nov",
    },
  ],
  proposals: [
    {
      channel: "instagram",
      why: "Founders save setup checklists",
      what: "Quote images of setup tips",
      perMonth: 8,
    },
  ],
  mix: [
    { approach: "educational", share: 60, why: "Setup is the question" },
    { approach: "social-proof", share: 40, why: "Proof beats promises" },
  ],
  objective: {
    metric: "Trial starts",
    baseline: "About 20 a month",
    baselineBasis: "assumption",
    target: "35 by 23 Nov",
  },
  focus: { segment: "Bootstrapped SaaS founders", problem: "Setup takes days" },
  offer: {
    what: "14-day trial",
    why: "Proof before paying",
    action: "Start a trial",
  },
  campaigns: [
    {
      id: "proof",
      name: "Setup proof",
      message: "Live in ten minutes",
      channels: ["linkedin"],
      start: "2026-10-27",
      end: "2026-11-09",
      metric: "20 trials",
    },
  ],
  weeks: [
    {
      focus: "Launch the proof",
      tasks: [
        { task: "Write the first posts", owner: "cuso" },
        { task: "Confirm the trial length", owner: "you", approval: true },
      ],
    },
  ],
  budget: { total: "0 dollars, organic only", basis: "assumption" },
  openQuestions: ["How many trials start in a normal month?"],
};

const overview = (patch: Partial<Strategy> = {}) =>
  cmoOverview({
    businessName: "acme.io",
    websiteUrl: "https://acme.io",
    projectLogo: null,
    brandVisual: {
      logoUrl: null,
      colors: ["#6349ea"],
      fonts: [],
      siteName: "Acme",
      designMdUrl: null,
      images: [],
    },
    strategy: { ...strategy, ...patch },
  });

describe("strategy reveal", () => {
  it("shows every piece but skipped ones, earliest first", () => {
    expect(planPieces(calendar).map((item) => item.id)).toEqual([
      "a",
      "b",
      "c",
      "e",
    ]);
  });

  it("states the goal, not the number", () => {
    expect(goalLine("Qualified intro calls")).toBe(
      "More qualified intro calls",
    );
    expect(goalLine("Increase website traffic")).toBe(
      "Increase website traffic",
    );
  });

  // Owner, 2026-11-23: the pillar cards sorted the same posts again, with
  // shares that read as a decision and every network on every pillar.
  it("names the topics in one line under what the posts do", () => {
    const pillars = [
      { name: "Launch timing", share: 60, why: "When buyers launch" },
      { name: "Community", share: 40 },
    ];
    const plan = overview({
      pillars,
      mix: [{ approach: "educational", share: 100, why: "Launch lessons" }],
      calendar: calendar.map((piece) => ({ ...piece, pillar: "Community" })),
    });
    const html = renderToStaticMarkup(
      <PlanPanel overview={plan} strategy={plan.strategy as Strategy} />,
    );
    expect(html).toContain("What the posts do");
    expect(html).toContain(
      "Topics Cuso keeps coming back to: Launch timing · Community",
    );
    expect(html).not.toContain("Content pillars");
    expect(html).not.toContain("60%");
    expect(html).not.toContain("When buyers launch");
  });
});

describe("pluralName", () => {
  it("puts the post in a name that goes on after it in the plural", () => {
    expect(pluralName("Post with a reply")).toBe("posts with a reply");
  });

  it("names a plain format in the plural, no count", () => {
    expect(pluralName("Image post")).toBe("image posts");
    expect(pluralName("YouTube Short")).toBe("YouTube Shorts");
  });

  it("keeps the platforms' format names", () => {
    expect(pluralName("Reel")).toBe("Reels");
    expect(pluralName("Talking YouTube Short")).toBe("Talking YouTube Shorts");
  });
});

it("shows a talking video on YouTube too, without counts, and names a network left out with its reason", async () => {
  const { richPlan } = await import("../test-fixtures/onboarding");
  const { ChannelPlan } = await import("./strategy-reveal");
  const html = renderToStaticMarkup(<ChannelPlan strategy={richPlan} />);
  // YouTube has no entry of its own: its piece is LinkedIn's talking video.
  const youtube = html.slice(html.indexOf("YouTube</p>"));
  expect(youtube.slice(0, youtube.indexOf("</li>"))).toMatch(
    /Talking YouTube Shorts/,
  );
  // What Cuso makes, never how many or how often (owner, 2026-11-23).
  expect(html).not.toMatch(/\d+ (a day|a week|this month)|\d+ (image )?posts/);
  expect(youtube.slice(0, youtube.indexOf("</li>"))).not.toMatch(/\d/);
  expect(html).toContain(
    "<b>Not on Facebook.</b> Product teams do not follow software vendors on Facebook.",
  );
  // A network left out is not offered again as one Cuso could add.
  expect(html).not.toMatch(/can also run[^<]*Facebook[,. ]/);
});

it("says what Cuso does for the owner's site, which is never on the calendar", async () => {
  const { richPlan } = await import("../test-fixtures/onboarding");
  const { ChannelPlan } = await import("./strategy-reveal");
  const html = renderToStaticMarkup(<ChannelPlan strategy={richPlan} />);
  expect(html).toContain("Your website and Google search");
  expect(html).toContain(
    "A weekly audit of your site, page fixes, and articles",
  );
  expect(html).toContain("You put them on your site.");
});
