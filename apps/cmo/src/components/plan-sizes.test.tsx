import type { CmoOverview } from "@sokosumi/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { strategy } from "../test-fixtures/onboarding";
import { PlanSizes } from "./plan-sizes";

type Strategy = NonNullable<CmoOverview["strategy"]>;

const day = (index: number) =>
  `2026-11-${String(2 + (index % 28)).padStart(2, "0")}`;

it("says a short video counts on each network it goes out on, and how many videos each plan makes", () => {
  // NMKR, 2026-11-23: Instagram read 95 on Starter beside YouTube's 68,
  // because the Reels are the Shorts.
  const shorts = Array.from({ length: 196 }, (_, index) => ({
    id: `v${index}`,
    date: day(Math.floor(index / 7)),
    channel: "youtube",
    title: `Short ${index}`,
    format: "short",
    status: "idea" as const,
    alsoOn: ["instagram", "tiktok"],
  }));
  const pictures = Array.from({ length: 56 }, (_, index) => ({
    id: `i${index}`,
    date: day(Math.floor(index / 2)),
    channel: "instagram",
    title: `Picture ${index}`,
    format: "carousel",
    status: "idea" as const,
  }));
  const month: Strategy = { ...strategy, calendar: [...shorts, ...pictures] };
  const html = renderToStaticMarkup(<PlanSizes strategy={month} />);
  expect(html).toContain(
    "Each short video goes out on TikTok, Instagram (as a Reel) and YouTube (as a Short) at once, so it counts on each.",
  );
  expect(html).toContain(
    "New videos a month: Starter 68, Growth 112, Scale 196.",
  );
});

it("says nothing about shared videos when there are none", () => {
  const html = renderToStaticMarkup(<PlanSizes strategy={strategy} />);
  expect(html).not.toContain("Each short video");
});
