import type { CmoOverview } from "@sokosumi/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { strategy } from "../../test-fixtures/onboarding";
import { FunnelPlan } from "../strategy-core";
import { MonthPanel } from "./plan-tabs";

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

it("says the month is topics made after approval, with its pictures, videos and pillars", () => {
  const html = renderToStaticMarkup(
    <MonthPanel strategy={withMedia} onOpen={() => {}} pending />,
  );
  expect(html).toContain("These are the topics.");
  expect(html).toContain("5 pieces · 1 with pictures · 1 video");
  expect(html).toContain('aria-label="Image"');
  expect(html).toContain('aria-label="Video"');
  expect(html).toContain("Behind the build");
  expect(html).toContain("ob-entry pending");
});

it("drops the topics note once the plan is approved", () => {
  const html = renderToStaticMarkup(
    <MonthPanel strategy={withMedia} onOpen={() => {}} />,
  );
  expect(html).not.toContain("These are the topics.");
  expect(html).not.toContain("ob-entry pending");
});

it("names each funnel stage's step and keeps the plays behind How", () => {
  const html = renderToStaticMarkup(
    <FunnelPlan
      stages={[
        {
          stage: "awareness",
          name: "Hear about us",
          goal: "Teams see a launch story",
          metric: "Profile visits",
          plays: [
            { channel: "x", what: "Share launch lessons", cadence: "Daily" },
          ],
        },
        {
          stage: "conversion",
          name: "Start a trial",
          goal: "Teams try it",
          metric: "Trial starts",
          owner: "shared",
        },
      ]}
      improvements={[]}
    />,
  );
  expect(html).toContain("Get seen");
  expect(html).toContain("Get chosen");
  expect(html).toMatch(
    /<details class="sc-how"><summary>How<\/summary>.*Share launch lessons/,
  );
  expect(html).not.toContain("runs this");
  expect(html).toContain("and you");
});
