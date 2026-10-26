import type { CmoOverview } from "@sokosumi/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { planPieces } from "./phone-feeds";
import { goalLine, planDays, StrategyReveal } from "./strategy-reveal";

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
  pillars: ["Setup proof"],
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
  ({
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
  }) as unknown as CmoOverview;

describe("strategy reveal", () => {
  it("counts at least four weeks from the first piece", () => {
    const days = planDays(calendar);
    expect(days[0]).toBe("2026-10-27");
    expect(days).toHaveLength(28);
    expect(planDays([])).toEqual([]);
  });

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

  it("opens on the goal, then the month, the barrier and the mix", () => {
    const html = renderToStaticMarkup(
      <StrategyReveal
        overview={overview()}
        calendar={<p>The calendar</p>}
        onAsk={async () => {}}
      />,
    );
    expect(html).toContain("More trial starts");
    expect(html).not.toContain("35 by 23 Nov");
    expect(html).toContain("4 pieces, 1 with images by Cuso.");
    expect(html).toContain("LinkedIn posts");
    expect(html).toContain("How people become customers");
    expect(html).toContain("Hear about us");
    expect(html).toContain("Trial starts · 40 by 30 Nov");
    expect(html).toContain("Channels you could add");
    expect(html).toContain("Quote images of setup tips");
    expect(html).toContain("if you add Instagram");
    expect(html).toContain("Founders don&#x27;t see how setup works");
    expect(html).toContain("So most posts teach.");
    expect(html).toContain("Helpful tips");
    expect(html).toContain("60%");
    expect(html).toContain("proof beats promises");
    expect(html).toContain("Setup proof");
    expect(html).toContain("The calendar");
    expect(html).toContain("1 question to make this");
    // Campaigns, weekly tasks and the budget wait under "The details".
    expect(html).toContain("The details");
    expect(html).not.toContain("Live in ten minutes");
    expect(html).not.toContain("0 dollars, organic only");
  });
});
