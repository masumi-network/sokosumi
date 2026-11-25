import type { CmoOverview } from "@sokosumi/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { richPlan, strategy } from "../../test-fixtures/onboarding";
import { FunnelPlan } from "../strategy-core";
import { MonthPanel, ResultsPanel } from "./plan-tabs";

type Strategy = NonNullable<CmoOverview["strategy"]>;

const withMedia: Strategy = {
  ...strategy,
  calendar: [
    ...strategy.calendar,
    {
      id: "img",
      date: "2026-10-07",
      channel: "x",
      title: "The rocket up close",
      format: "image",
      status: "idea",
      pillar: "Behind the build",
    },
    {
      id: "vid",
      date: "2026-10-08",
      channel: "linkedin",
      title: "Liftoff in five seconds",
      format: "video",
      status: "idea",
    },
  ],
};

it("says the month is topics made after approval, with media marks, no counts or pillar chips", () => {
  const html = renderToStaticMarkup(
    <MonthPanel strategy={withMedia} onOpen={() => {}} pending />,
  );
  expect(html).toContain("These are the topics.");
  expect(html).not.toContain("5 posts");
  expect(html).toContain('aria-label="Image"');
  expect(html).toContain('aria-label="Video"');
  expect(html).not.toContain("Behind the build");
  expect(html).toContain("ob-entry pending");
});

it("drops the topics note once the plan is approved", () => {
  const html = renderToStaticMarkup(
    <MonthPanel strategy={withMedia} onOpen={() => {}} />,
  );
  expect(html).not.toContain("These are the topics.");
  expect(html).not.toContain("ob-entry pending");
});

// cmo-v22: the calendar holds the strategy's example posts until Core writes the month.
it("calls a cmo-v22 calendar example posts, before payment and while Core plans", () => {
  const examples: Strategy = {
    ...withMedia,
    monthWriter: { state: "examples", attempts: 0 },
  };
  const before = renderToStaticMarkup(
    <MonthPanel strategy={examples} onOpen={() => {}} pending />,
  );
  expect(before).toContain("These are example posts.");
  expect(before).toContain(
    "Once you subscribe, I plan every post your plan makes",
  );
  expect(before).not.toContain("These are the topics.");
  const planning = renderToStaticMarkup(
    <MonthPanel
      strategy={{ ...examples, monthWriter: { state: "writing", attempts: 1 } }}
      onOpen={() => {}}
    />,
  );
  expect(planning).toContain("planning every post your plan makes");
  const written = renderToStaticMarkup(
    <MonthPanel
      strategy={{ ...examples, monthWriter: { state: "written", attempts: 1 } }}
      onOpen={() => {}}
    />,
  );
  expect(written).not.toContain("example posts");
});

it("shows a short video and its copies as one card with every network", () => {
  const video = {
    date: "2026-10-08",
    time: "08:30",
    title: "Mint in one minute",
    format: "video",
    status: "scheduled" as const,
  } as const;
  const html = renderToStaticMarkup(
    <MonthPanel
      strategy={{
        ...strategy,
        calendar: [
          {
            ...video,
            id: "v",
            channel: "youtube",
            alsoOn: ["instagram", "tiktok"],
          },
          { ...video, id: "v-ig", channel: "instagram", videoOf: "v" },
          { ...video, id: "v-tt", channel: "tiktok", videoOf: "v" },
        ],
      }}
      onOpen={() => {}}
    />,
  );
  // Once in Up first, once on its day; the copies add no cards.
  expect(html.match(/Mint in one minute/g)).toHaveLength(2);
});

it("shows three cards a day and opens the rest from +N more", () => {
  const calendar = Array.from({ length: 5 }, (_, index) => ({
    id: `p${index}`,
    date: "2026-10-08",
    time: `0${index}:00`,
    channel: "x",
    title: `Post ${index}`,
    format: "text",
    status: "scheduled" as const,
  }));
  const html = renderToStaticMarkup(
    <MonthPanel strategy={{ ...strategy, calendar }} onOpen={() => {}} />,
  );
  expect(html).toContain("+2 more");
  expect(html).not.toContain("Post 4");
});

it("shows each step's goal and its share of the month, and no network", () => {
  const piece = (
    id: string,
    stage: "awareness" | "action",
    alsoOn?: string[],
  ) => ({
    id,
    date: "2026-10-07",
    channel: "x",
    title: id,
    format: "post",
    status: "idea" as const,
    stage,
    ...(alsoOn ? { alsoOn } : {}),
  });
  const html = renderToStaticMarkup(
    <FunnelPlan
      stages={[
        {
          stage: "awareness",
          name: "Hear about us",
          goal: "Teams find out NMKR exists",
          metric: "Profile visits",
          plays: [
            { channel: "x", what: "Share launch lessons", cadence: "6 a day" },
          ],
        },
        {
          stage: "action",
          goal: "Teams open a free NMKR Studio account",
          metric: "Accounts",
          owner: "shared",
          youDo: "You keep signup clear.",
        },
      ]}
      calendar={[
        // A short video counts on all three networks it goes out on.
        piece("v", "awareness", ["instagram", "tiktok"]),
        piece("a", "awareness"),
        piece("o", "action"),
        { ...piece("s", "action"), status: "skipped" },
      ]}
    />,
  );
  expect(html).toContain("Awareness");
  expect(html).toContain("Teams find out NMKR exists");
  expect(html).not.toContain("Hear about us");
  expect(html).toMatch(
    /About <b class="num">80%<\/b> of this month&#x27;s posts/,
  );
  expect(html).toMatch(
    /About <b class="num">20%<\/b> of this month&#x27;s posts/,
  );
  // Networks, cadences and the parts per step stay off the funnel.
  expect(html).not.toContain("Share launch lessons");
  expect(html).not.toContain("6 a day");
  expect(html).not.toContain("You keep signup clear.");
  expect(html).not.toContain("Profile visits");
});

it("leaves the share out when no piece names its step", () => {
  const html = renderToStaticMarkup(
    <FunnelPlan stages={richPlan.funnel ?? []} calendar={richPlan.calendar} />,
  );
  expect(html).not.toContain("of this month&#x27;s posts");
});

it("names each tracked step by its classic stage, never a name of Cuso's own", () => {
  const html = renderToStaticMarkup(
    <ResultsPanel strategy={richPlan} approved={false} />,
  );
  expect(html).toMatch(/Awareness<\/span><b>Profile visits/);
  expect(html).not.toContain("Hear about us");
});

it("draws each stage as a slice of one funnel that narrows to the sale", () => {
  const html = renderToStaticMarkup(
    <FunnelPlan stages={richPlan.funnel ?? []} calendar={richPlan.calendar} />,
  );
  const slices = [...html.matchAll(/<polygon[^>]*points="([^"]+)"/g)].map(
    (match) =>
      (match[1] ?? "").split(" ").map((point) => Number(point.split(",")[0])),
  );
  expect(slices).toHaveLength(richPlan.funnel?.length ?? 0);
  slices.forEach((slice, index) => {
    const [topLeft = 0, topRight = 0, bottomRight = 0, bottomLeft = 0] = slice;
    // Narrower at its bottom than at its top.
    expect(bottomRight - bottomLeft).toBeLessThan(topRight - topLeft);
    // And as wide at its top as the slice above ends.
    const above = slices[index - 1];
    if (above) expect(topLeft).toBeCloseTo(above[3] ?? -1);
  });
  expect(slices[0]?.[0]).toBe(0);
  // The sale is the green slice, whatever the number of stages.
  expect(html.match(/sc-segment (\w+)/g)?.at(-1)).toBe("sc-segment green");
});

it("shows the four AIDA steps, each drawn as its slice", () => {
  const html = renderToStaticMarkup(
    <FunnelPlan stages={richPlan.funnel ?? []} calendar={richPlan.calendar} />,
  );
  const labels = [...html.matchAll(/<h3 class="sc-stage-name">([^<]+)</g)].map(
    (match) => match[1],
  );
  expect(labels).toEqual(["Awareness", "Interest", "Desire", "Action"]);
  // Four slices: paper, Iris, yellow, and green for the sale.
  expect(html.match(/sc-segment (\w+)/g)).toEqual([
    "sc-segment paper",
    "sc-segment iris",
    "sc-segment yellow",
    "sc-segment green",
  ]);
});
