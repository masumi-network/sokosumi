import type { Prisma } from "@sokosumi/database";
import { cmoMonthAtLevel } from "@sokosumi/utils";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));
// "flagged" is a Cuso version that lists cmo-video-shapes; no live one does yet.
vi.mock("@sokosumi/soko-bot", async () => {
  const actual =
    await vi.importActual<typeof import("@sokosumi/soko-bot")>(
      "@sokosumi/soko-bot",
    );
  return {
    ...actual,
    getSokoBotVersion: (id: string) =>
      id === "flagged"
        ? {
            ...actual.getSokoBotVersion("cmo-v24"),
            skills: [
              ...actual.getSokoBotVersion("cmo-v24").skills,
              actual.CMO_VIDEO_SHAPES_SKILL,
            ],
          }
        : actual.getSokoBotVersion(id),
  };
});

import {
  cmoAlsoOnProblem,
  listMarketingStrategyPosts,
  planMarketingStrategyPosts,
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
  const duplicate =
    'X rejected the post: Request failed error: `{"detail":"You are not allowed to create a Tweet with duplicate content.","status":403}`';

  it("says why in the owner's words, not the network's JSON", () => {
    expect(
      socialPostNotSent({
        status: "FAILED",
        provider: "x",
        lastError: duplicate,
      }),
    ).toBe(
      "X refused it: You are not allowed to create a Tweet with duplicate content.",
    );
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

  it("never asks the owner to raise our app's cap", () => {
    // Paused and moved on by the publisher: it waits, in our words.
    expect(
      socialPostNotSent({
        status: "SCHEDULED",
        provider: "x",
        lastError: "X paused our posting for now. We try again every hour.",
      }),
    ).toBe("X paused our posting for now; Cuso will try again.");
    // Failed on the cap before the publisher held such posts, or after a day.
    for (const lastError of [
      spendCap,
      "X paused our posting for a day, so this post didn't go out.",
    ]) {
      const said = socialPostNotSent({
        status: "FAILED",
        provider: "x",
        lastError,
      });
      expect(said).toBe(
        "X paused our posting for a day. Ask Cuso to post it again.",
      );
      expect(said).not.toMatch(/cap/i);
    }
  });

  it("is said nowhere for a post on its way or out", () => {
    for (const status of ["DRAFT", "SCHEDULED", "PUBLISHED"] as const) {
      expect(
        socialPostNotSent({ status, provider: "x", lastError: duplicate }),
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
      "X paused our posting for a day. Ask Cuso to post it again.",
    );
  });
});

describe("a talking video's post planned again", () => {
  const media = [
    {
      kind: "video",
      name: "old.mp4",
      size: 1,
      fileUrl: "https://blob.example/old.mp4",
      mimeType: "video/mp4",
      pathname: "drive/old.mp4",
    },
  ];

  async function plan(newScript: string) {
    const updates: { where: { id: string }; data: Record<string, unknown> }[] =
      [];
    const tx = {
      socialPost: {
        findMany: async () => [
          {
            id: "post-1",
            status: "SCHEDULED",
            provider: "linkedin",
            media,
            planning: {
              id: "w2",
              title: "A free homepage",
              format: "talking_video",
              script: "Entry Free costs zero euros forever.",
              presenter: "maya",
              voice: "Aria",
            },
          },
        ],
        update: async (input: (typeof updates)[number]) => {
          updates.push(input);
        },
        createMany: async () => undefined,
      },
      projectSocialConnection: { findMany: async () => [] },
      sokoBotSchedule: { findMany: async () => [] },
    } as unknown as Prisma.TransactionClient;
    await planMarketingStrategyPosts(tx, {
      version: { id: "version-2", projectId: "project-1" },
      workspaceId: "workspace-1",
      creator: { userId: "user-1" },
      entries: [
        {
          id: "w2",
          date: "2026-11-30",
          time: "11:00",
          channel: "linkedin",
          format: "talking_video",
          title: "A free homepage",
          status: "draft",
          script: newScript,
          presenter: "maya",
          voice: "Aria",
        } as never,
      ],
    });
    return updates[0]?.data;
  }

  it("drops a video made for other words, so Core makes the new one", async () => {
    const data = await plan("Your work already has a home in GitHub.");
    expect(data).toMatchObject({ media: [], status: "DRAFT" });
  });

  it("keeps a video whose words did not change", async () => {
    const data = await plan("Entry Free costs zero euros forever.");
    expect(data).not.toHaveProperty("media");
    expect(data).not.toHaveProperty("status");
  });
});

describe("a video in other shapes", () => {
  const entry = {
    id: "v1",
    date: "2026-11-30",
    time: "11:00",
    channel: "instagram",
    format: "reel",
    title: "Roasted this morning",
    status: "draft",
    shortFormat: "voiceover",
    script: "Most coffee sits for weeks before you drink it.",
    alsoOn: ["tiktok", "instagram_feed", "x", "linkedin_wide"],
  };

  async function plan(versionId: string, existing: unknown[] = []) {
    const created: Record<string, unknown>[] = [];
    const canceled: string[] = [];
    const tx = {
      socialPost: {
        findMany: async () => existing,
        update: async (input: {
          where: { id: string };
          data: { status?: string };
        }) => {
          if (input.data.status === "CANCELED") canceled.push(input.where.id);
        },
        createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
          created.push(...data);
        },
      },
      sokoBot: { findFirst: async () => ({ versionId }) },
      projectSocialConnection: { findMany: async () => [] },
      sokoBotSchedule: { findMany: async () => [] },
    } as unknown as Prisma.TransactionClient;
    await planMarketingStrategyPosts(tx, {
      version: { id: "version-1", projectId: "project-1" },
      workspaceId: "workspace-1",
      creator: { userId: "user-1" },
      entries: [entry as never],
    });
    return {
      created: created.map((post) => ({
        provider: post.provider,
        format: (post.planning as { format: string }).format,
        id: (post.planning as { id: string }).id,
        videoOf: (post.planning as { videoOf?: string }).videoOf,
      })),
      canceled,
    };
  }

  it("is posted on each target as its own post, for a version that opts in", async () => {
    const { created } = await plan("flagged");
    expect(created).toEqual([
      { provider: "instagram", format: "reel", id: "v1", videoOf: undefined },
      { provider: "tiktok", format: "video", id: "v1@tiktok", videoOf: "v1" },
      {
        provider: "instagram",
        format: "feed_video",
        id: "v1@instagram_feed",
        videoOf: "v1",
      },
      { provider: "x", format: "video", id: "v1@x", videoOf: "v1" },
      {
        provider: "linkedin",
        format: "wide_video",
        id: "v1@linkedin_wide",
        videoOf: "v1",
      },
    ]);
  });

  it("is left out for every other version, which keeps its copies as before", async () => {
    const { created } = await plan("cmo-v24");
    expect(created.map((post) => post.id)).toEqual(["v1", "v1@tiktok"]);
  });

  it("cancels only the shape taken off the list, not the Reel on the same network", async () => {
    const post = (id: string, provider: string, planningId: string) => ({
      id,
      status: "DRAFT",
      provider,
      media: [],
      planning: {
        id: planningId,
        title: "Roasted this morning",
        format: "feed_video",
        videoOf: "v1",
      },
    });
    const { canceled } = await plan("flagged", [
      post("post-feed", "instagram", "v1@instagram_feed"),
      post("post-old", "instagram", "v1@facebook_feed"),
    ]);
    expect(canceled).toEqual(["post-old"]);
  });

  it("refuses a target in alsoOn unless the version opts in", () => {
    expect(cmoAlsoOnProblem(entry, false)).toContain(
      "cannot also go out on instagram_feed, x, linkedin_wide",
    );
    expect(cmoAlsoOnProblem(entry, true)).toBeNull();
  });
});
