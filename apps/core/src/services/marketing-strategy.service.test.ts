import type { Prisma } from "@sokosumi/database";
import { cmoMonthAtLevel } from "@sokosumi/utils";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

import {
  listMarketingStrategyPosts,
  socialPostNotSent,
} from "@/services/marketing-strategy.service";

const script = "Name the asset, map the buyer path, then pick a mint route.";

function row(
  id: string,
  provider: string,
  planning: Record<string, unknown>,
  failed: { status?: string; lastError?: string | null } = {},
) {
  return {
    id,
    provider,
    text: "Caption",
    media: [],
    status: failed.status ?? "DRAFT",
    lastError: failed.lastError ?? null,
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

describe("a post that did not go out", () => {
  const spendCap =
    'X rejected the post: Request failed error: `{"detail":"Your monthly spend cap has been reached.","status":403}`';

  it("says why in the owner's words, not the network's JSON", () => {
    expect(
      socialPostNotSent({
        status: "FAILED",
        provider: "x",
        lastError: spendCap,
      }),
    ).toBe("X refused it: Your monthly spend cap has been reached.");
    expect(
      socialPostNotSent({
        status: "FAILED",
        provider: "linkedin",
        lastError: null,
      }),
    ).toBe("LinkedIn refused it.");
    expect(
      socialPostNotSent({
        status: "FAILED",
        provider: "instagram",
        lastError: "Social connection needs reconnecting",
      }),
    ).toBe("Instagram needs reconnecting in Channels.");
    expect(
      socialPostNotSent({
        status: "MISSED",
        provider: "x",
        lastError: "Missed: found 40 minutes after the planned time",
      }),
    ).toBe("It missed its time.");
  });

  it("is said nowhere for a post on its way or out", () => {
    for (const status of ["DRAFT", "SCHEDULED", "PUBLISHED"] as const) {
      expect(
        socialPostNotSent({ status, provider: "x", lastError: spendCap }),
      ).toBeNull();
    }
  });

  it("reaches the calendar entry, which still reads as written", async () => {
    const [post] = await listMarketingStrategyPosts(
      { id: "version-1", projectId: "project-1" },
      db([
        row(
          "post-x",
          "x",
          { id: "e1", format: "image" },
          {
            status: "FAILED",
            lastError: spendCap,
          },
        ),
      ]),
    );
    expect(post?.entry.status).toBe("draft");
    expect(post?.entry.notSent).toBe(
      "X refused it: Your monthly spend cap has been reached.",
    );
  });
});
