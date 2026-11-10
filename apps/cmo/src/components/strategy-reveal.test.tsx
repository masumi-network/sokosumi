import type { CmoOverview } from "@sokosumi/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { cmoOverview } from "../test-fixtures/cmo";
import { PlanPanel } from "./onboarding/plan-tabs";
import { goalLine, planPieces } from "./strategy-reveal";

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

  it("shows each pillar's share, and once the month is made, the share Cuso's pieces have", () => {
    const pillars = [
      { name: "Setup proof", share: 60, why: "Shows setup takes minutes" },
      { name: "Founder stories", share: 40 },
    ];
    const planned = renderToStaticMarkup(
      <PlanPanel
        overview={overview({
          pillars,
          calendar: calendar.map((piece) => ({
            ...piece,
            pillar: "Setup proof",
          })),
        })}
        strategy={
          overview({
            pillars,
            calendar: calendar.map((piece) => ({
              ...piece,
              pillar: "Setup proof",
            })),
          }).strategy as Strategy
        }
      />,
    );
    expect(planned).toContain("What the posts are about");
    expect(planned).toContain("Shows setup takes minutes");
    expect(planned).toContain("4 pieces planned");
    expect(planned).not.toContain("% made");

    const made = {
      ...overview({ pillars }),
      production: {
        state: "ready" as const,
        ready: 4,
        total: 4,
        written: 4,
        pictured: 0,
        needPictures: 0,
        finishedAt: null,
        pillars: {
          shares: [
            { name: "Setup proof", planned: 60, made: 75, pieces: 3 },
            { name: "Founder stories", planned: 40, made: 25, pieces: 1 },
          ],
          rewriting: true,
        },
      },
    };
    const html = renderToStaticMarkup(
      <PlanPanel overview={made} strategy={made.strategy as Strategy} />,
    );
    expect(html).toContain("75% made · 60% planned");
    expect(html).toContain("Cuso is rewriting them now.");
  });
});
