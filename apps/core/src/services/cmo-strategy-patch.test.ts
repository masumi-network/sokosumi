import { marketingStrategyPlanSchema } from "@sokosumi/soko-bot";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

import { patchPlan } from "@/services/cmo-strategy.service";

type Plan = Parameters<typeof patchPlan>[0];

const video = {
  id: "w1-03",
  date: "2026-11-21",
  time: "11:00",
  channel: "linkedin",
  title: "How Ebbets began with wool",
  format: "talking_video",
  status: "idea",
  alsoOn: ["instagram", "facebook", "youtube", "tiktok"],
};

const plan: Plan = marketingStrategyPlanSchema.parse({
  month: "2026-11",
  summary: "Wool jackets and jerseys for winter",
  goals: ["More jacket orders"],
  pillars: [],
  channels: [],
  calendar: [video],
});

describe("a patch that turns a talking video into another format", () => {
  it("drops the networks only a talking video goes out on", () => {
    const { alsoOn: _kept, ...sent } = { ...video, format: "video" };
    const patched = patchPlan(
      plan,
      { calendar: [sent] } as unknown as Parameters<typeof patchPlan>[1],
      [],
    );
    expect(patched.calendar[0]?.format).toBe("video");
    expect(patched.calendar[0]?.alsoOn).toBeUndefined();
  });

  it("keeps them while it stays a talking video", () => {
    const { alsoOn: _kept, ...sent } = { ...video, title: "Wool, 1988" };
    const patched = patchPlan(
      plan,
      { calendar: [sent] } as unknown as Parameters<typeof patchPlan>[1],
      [],
    );
    expect(patched.calendar[0]?.alsoOn).toEqual(video.alsoOn);
  });

  it("keeps a short's other networks when the patch changes its words", () => {
    const short = {
      id: "w1-04",
      date: "2026-11-22",
      channel: "tiktok",
      title: "Wool in the rain",
      format: "video",
      status: "idea",
      alsoOn: ["instagram", "youtube", "x"],
    };
    const withShort = marketingStrategyPlanSchema.parse({
      ...plan,
      calendar: [short],
    });
    const { alsoOn: _kept, ...sent } = { ...short, title: "Wool, wet" };
    const patched = patchPlan(
      withShort,
      { calendar: [sent] } as unknown as Parameters<typeof patchPlan>[1],
      [],
    );
    expect(patched.calendar[0]?.alsoOn).toEqual(short.alsoOn);
  });
});
