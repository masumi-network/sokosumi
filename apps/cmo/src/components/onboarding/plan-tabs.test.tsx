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

it("draws each stage as a slice of one funnel that narrows to the sale", () => {
  const html = renderToStaticMarkup(
    <FunnelPlan
      stages={richPlan.funnel ?? []}
      improvements={richPlan.improvements ?? []}
    />,
  );
  const slices = [...html.matchAll(/<polygon points="([^"]+)"/g)].map((match) =>
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

it("sets a short value as the stage's number and a sentence as plain words", () => {
  const stage = (value: string) =>
    renderToStaticMarkup(
      <FunnelPlan
        stages={[
          {
            stage: "awareness",
            name: "Hear about us",
            goal: "Holders compare wallets",
            metric: "Followers",
            measure: { value, basis: "estimated" },
          },
        ]}
        improvements={[]}
      />,
    );
  expect(stage("About 60 a month")).toContain(
    '<b class="num">About 60 a month</b>',
  );
  const sentence = "X has 33.4K followers; visits are not reported.";
  expect(stage(sentence)).toContain(`<span>${sentence}</span>`);
  expect(stage(sentence)).not.toContain('<b class="num">');
});
