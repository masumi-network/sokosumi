import type { CmoOverview } from "@sokosumi/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { draft, richPlan, strategy } from "../../test-fixtures/onboarding";
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

it("says the month is topics made after approval, with its pictures, videos and pillars", () => {
  const html = renderToStaticMarkup(
    <MonthPanel strategy={withMedia} onOpen={() => {}} pending />,
  );
  expect(html).toContain("These are the topics.");
  expect(html).toContain("5 posts · 1 with pictures · 1 video");
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

it("shows each stage's classic step, Cuso's part, the owner's part and its number, with nothing folded", () => {
  const html = renderToStaticMarkup(
    <FunnelPlan
      stages={[
        {
          stage: "awareness",
          name: "Hear about us",
          goal: "Teams see a launch story",
          metric: "Profile visits",
          measure: { value: "About 400 a month", basis: "estimated" },
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
  expect(html).toContain("Awareness");
  expect(html).toContain("Conversion");
  expect(html).not.toContain("Hear about us");
  expect(html).not.toContain("Start a trial");
  expect(html).not.toContain("<details");
  expect(html).toMatch(/What Cuso does.*Share launch lessons/);
  expect(html).not.toContain("Daily");
  expect(html).toContain("Nothing. Cuso runs this step.");
  expect(html).toContain("Cuso suggests changes, you decide.");
  expect(html).toMatch(
    /Profile visits.*About 400 a month.*Cuso&#x27;s estimate/,
  );
  expect(html).toMatch(/Trial starts.*Not measured yet/);
});

it("names each tracked step by its classic stage, never a name of Cuso's own", () => {
  const html = renderToStaticMarkup(
    <ResultsPanel
      overview={draft({ strategy: richPlan })}
      strategy={richPlan}
      onConnectMeasurement={async () => ({ url: null, error: null })}
    />,
  );
  expect(html).toMatch(/Awareness<\/span><b>Profile visits/);
  expect(html).not.toContain("Hear about us");
});

it("shows the four AIDA stages with Cuso's sentence and the owner's", () => {
  const html = renderToStaticMarkup(
    <FunnelPlan
      stages={richPlan.funnel ?? []}
      improvements={richPlan.improvements ?? []}
    />,
  );
  const labels = [...html.matchAll(/<h3 class="sc-stage-name">([^<]+)</g)].map(
    (match) => match[1],
  );
  expect(labels).toEqual(["Awareness", "Interest", "Desire", "Action"]);
  expect(html).toContain(
    "I post launch stories on LinkedIn and a launch lesson a day on X.",
  );
  expect(html).toContain("You send me one customer result a month.");
  expect(html).toContain("You answer every trial sign-up within a day.");
  // At the sale the owner's sentence leads Cuso's ideas for their pages.
  expect(html).toMatch(/within a day\.<\/p><ul class="sc-ideas">/);
  expect(html).not.toContain("<details");
});
