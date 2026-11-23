import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { cmoPlanSchema } from "@/schemas/cmo.schema";

describe("cmoPlanSchema", () => {
  it("reads an approved month with hundreds of made posts", () => {
    // NMKR's approved month: 395 planned pieces became 697 Social posts,
    // short-video copies on Instagram, TikTok and YouTube included.
    const calendar = Array.from({ length: 697 }, (_, index) => ({
      id: `post-${index}`,
      socialPostId: randomUUID(),
      date: "2026-12-01",
      time: "09:00",
      channel: ["x", "instagram", "tiktok", "youtube"][index % 4],
      format: "post",
      title: `Piece ${index}`,
      status: "idea",
    }));
    const plan = {
      month: "2026-12",
      summary: "A month of NFT launch stories.",
      goals: ["More sign-ups"],
      pillars: [],
      channels: [],
      calendar,
    };
    const parsed = cmoPlanSchema.safeParse(plan);
    expect(parsed.error?.issues).toBeUndefined();
  });
});
