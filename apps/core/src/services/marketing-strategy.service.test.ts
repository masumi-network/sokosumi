import type { Prisma } from "@sokosumi/database";
import { cmoMonthAtLevel } from "@sokosumi/utils";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

import { listMarketingStrategyPosts } from "@/services/marketing-strategy.service";

const script = "Name the asset, map the buyer path, then pick a mint route.";

function row(id: string, provider: string, planning: Record<string, unknown>) {
  return {
    id,
    provider,
    text: "Caption",
    media: [],
    status: "DRAFT",
    revision: 1,
    scheduledAt: new Date("2026-11-22T17:30:00Z"),
    createdAt: new Date("2026-11-19T23:41:17Z"),
    planning: {
      title: "A first launch decision",
      format: "talking_video",
      script,
      ...planning,
    },
  };
}

function db(rows: ReturnType<typeof row>[]): Prisma.TransactionClient {
  return {
    socialPost: { findMany: async () => rows },
    sokoBotSchedule: { findMany: async () => [] },
  } as unknown as Prisma.TransactionClient;
}

describe("a talking video's posts on other networks", () => {
  const rows = [
    row("post-linkedin", "linkedin", { id: "c8" }),
    row("post-tiktok", "tiktok", { id: "c8@tiktok", videoOf: "c8" }),
    row("post-youtube", "youtube", { id: "c8@youtube", videoOf: "c8" }),
  ];

  it("name the video's post, as every entry reads under its post's id", async () => {
    const posts = await listMarketingStrategyPosts(
      { id: "version-1", projectId: "project-1" },
      db(rows),
    );
    expect(posts.map((post) => post.entry.videoOf)).toEqual([
      undefined,
      "post-linkedin",
      "post-linkedin",
    ]);
  });

  it("are made with the video, so they get it too", async () => {
    const posts = await listMarketingStrategyPosts(
      { id: "version-1", projectId: "project-1" },
      db(rows),
    );
    const { made } = cmoMonthAtLevel(
      posts.map((post) => post.entry),
      [],
      "steady",
    );
    expect([...made].sort()).toEqual([
      "post-linkedin",
      "post-tiktok",
      "post-youtube",
    ]);
  });
});
