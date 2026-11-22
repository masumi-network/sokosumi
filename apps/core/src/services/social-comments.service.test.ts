import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  commentFindFirst: vi.fn(),
  commentFindMany: vi.fn(async () => []),
  commentCreateMany: vi.fn(
    async (_args: {
      data: { socialPostId: string; externalCommentId: string }[];
    }) => ({ count: 0 }),
  ),
  postFindMany: vi.fn(
    async (_args: { where: Record<string, unknown> }): Promise<unknown[]> => [],
  ),
  commentCount: vi.fn(),
  commentUpdate: vi.fn(async () => ({})),
  commentUpdateMany: vi.fn(async () => ({ count: 1 })),
  connectionFindFirst: vi.fn(),
}));
const provider = vi.hoisted(() => ({
  reply: vi.fn(async () => "r1"),
  list: vi.fn(async () => []),
  listX: vi.fn(async () => []),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    socialComment: {
      findFirst: db.commentFindFirst,
      findMany: db.commentFindMany,
      createMany: db.commentCreateMany,
      count: db.commentCount,
      update: db.commentUpdate,
      updateMany: db.commentUpdateMany,
    },
    projectSocialConnection: { findFirst: db.connectionFindFirst },
    socialPost: { findMany: db.postFindMany },
  },
}));
vi.mock("@/clients/social-post-providers/comments", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/clients/social-post-providers/comments")
  >()),
  replyToComment: provider.reply,
  listPostComments: provider.list,
  listXReplies: provider.listX,
}));
vi.mock("@/services/project-social-connections.service", () => ({
  connectionExecutorUserId: () => "exec-1",
}));

import {
  collectNewSocialComments,
  handleSocialComment,
  SOCIAL_REPLIES_PER_DAY,
} from "./social-comments.service";

const comment = (patch: Record<string, unknown> = {}) => ({
  id: "c-1",
  projectId: "p-1",
  socialPostId: "post-1",
  provider: "instagram",
  externalCommentId: "ig-1",
  authorExternalId: "u-1",
  status: "NEW",
  socialPost: {
    socialConnectionId: "conn-1",
    provider: "instagram",
    publishedExternalId: "media-1",
  },
  ...patch,
});

const reply = (text = "Yes, it works offline.") =>
  handleSocialComment({
    projectId: "p-1",
    commentId: "c-1",
    action: "reply",
    reply: text,
  });

describe("handleSocialComment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.commentFindFirst.mockResolvedValue(comment());
    db.commentCount.mockResolvedValue(0);
    db.commentUpdateMany.mockResolvedValue({ count: 1 });
    db.connectionFindFirst.mockResolvedValue({
      composioConnectedAccountId: "ca-1",
      externalAccountId: "brand-1",
    });
  });

  it("never replies from a test copy, and leaves the comment new", async () => {
    db.commentFindFirst.mockResolvedValue(
      comment({
        socialPost: {
          socialConnectionId: "conn-1",
          provider: "instagram",
          project: { testCopyOfProjectId: "p-source" },
        },
      }),
    );
    await expect(reply()).rejects.toThrow("A test copy sends nothing at once");
    expect(provider.reply).not.toHaveBeenCalled();
    expect(db.commentUpdateMany).not.toHaveBeenCalled();
  });

  it("posts the reply and records it", async () => {
    await expect(reply()).resolves.toEqual({
      status: "replied",
      reply: "Yes, it works offline.",
    });
    expect(provider.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "instagram",
        connectedAccountId: "ca-1",
      }),
      {
        externalCommentId: "ig-1",
        externalPostId: "media-1",
        idempotencyKey: "c-1",
      },
      "Yes, it works offline.",
    );
    expect(db.commentUpdateMany).toHaveBeenCalledWith({
      where: { id: "c-1", status: "NEW" },
      data: expect.objectContaining({
        status: "REPLIED",
        reply: "Yes, it works offline.",
      }),
    });
    expect(db.commentUpdate).toHaveBeenCalledWith({
      where: { id: "c-1" },
      data: { replyExternalId: "r1" },
    });
  });

  it("never answers a comment twice", async () => {
    db.commentFindFirst.mockResolvedValue(comment({ status: "REPLIED" }));
    await expect(reply()).rejects.toThrow("handled already");
    expect(provider.reply).not.toHaveBeenCalled();
  });

  it("posts once when two calls race for the same comment", async () => {
    // Both read it as new; only the call that claims the row posts.
    db.commentUpdateMany.mockResolvedValueOnce({ count: 0 });
    await expect(reply()).rejects.toThrow("handled already");
    expect(db.commentUpdateMany).toHaveBeenCalledWith({
      where: { id: "c-1", status: "NEW" },
      data: expect.objectContaining({ status: "REPLIED" }),
    });
    expect(provider.reply).not.toHaveBeenCalled();
  });

  it("counts only other replies, so racing calls cannot pass the cap or the person rule", async () => {
    await reply();
    for (const [query] of db.commentCount.mock.calls) {
      expect(query.where.id).toEqual({ not: "c-1" });
    }
  });

  it("gives the comment back when the provider refuses the reply", async () => {
    provider.reply.mockRejectedValueOnce(new Error("rate limited"));
    await expect(reply()).rejects.toThrow("rate limited");
    expect(db.commentUpdateMany).toHaveBeenLastCalledWith({
      where: { id: "c-1", status: "REPLIED", replyExternalId: null },
      data: { status: "NEW", reply: null, handledAt: null },
    });
  });

  it("stops at the day's cap", async () => {
    db.commentCount.mockResolvedValueOnce(SOCIAL_REPLIES_PER_DAY);
    await expect(reply()).rejects.toThrow("today's last reply");
    expect(provider.reply).not.toHaveBeenCalled();
    expect(db.commentUpdateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "NEW" }),
      }),
    );
  });

  it("answers a person once per post", async () => {
    db.commentCount.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    await expect(reply()).rejects.toThrow("replied to this person");
    expect(provider.reply).not.toHaveBeenCalled();
  });

  it("refuses when the account is no longer connected", async () => {
    db.connectionFindFirst.mockResolvedValue(null);
    await expect(reply()).rejects.toThrow("no longer connected");
  });

  it("refuses an empty or overlong reply", async () => {
    await expect(reply("")).rejects.toThrow("1 to 300 characters");
    await expect(reply("x".repeat(301))).rejects.toThrow("1 to 300 characters");
  });

  it("holds an X reply to X's 280 characters", async () => {
    db.commentFindFirst.mockResolvedValue(comment({ provider: "x" }));
    await expect(reply("x".repeat(281))).rejects.toThrow("1 to 280 characters");
    expect(provider.reply).not.toHaveBeenCalled();
  });

  it("skips or hands to the owner without posting", async () => {
    await expect(
      handleSocialComment({
        projectId: "p-1",
        commentId: "c-1",
        action: "owner",
        note: "Asks for a refund",
      }),
    ).resolves.toEqual({ status: "owner" });
    expect(provider.reply).not.toHaveBeenCalled();
    expect(db.commentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c-1", status: "NEW" },
        data: expect.objectContaining({
          status: "OWNER",
          note: "Asks for a refund",
        }),
      }),
    );
  });
});

describe("collectNewSocialComments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.commentCount.mockResolvedValue(0);
  });
  const now = new Date("2026-11-22T08:00:00.000Z");
  const connection = (
    provider: string,
    composioConnectedAccountId: string,
  ) => ({
    provider,
    composioConnectedAccountId,
    externalAccountId: "brand-1",
  });

  it("reads X, LinkedIn and TikTok too: the networks real Cusos post to", async () => {
    db.postFindMany.mockResolvedValueOnce([
      {
        id: "x-1",
        provider: "x",
        publishedExternalId: "t-1",
        socialConnectionId: "cx",
      },
      {
        id: "x-2",
        provider: "x",
        publishedExternalId: "t-2",
        socialConnectionId: "cx",
      },
      {
        id: "li-1",
        provider: "linkedin",
        publishedExternalId: "z-1",
        socialConnectionId: "cl",
      },
    ] as never);
    db.connectionFindFirst.mockImplementation((async ({
      where,
    }: {
      where: { provider: string };
    }) =>
      where.provider === "x"
        ? connection("x", "ca-x")
        : connection("linkedin", "zernio:acc-1")) as never);
    provider.listX.mockResolvedValueOnce([
      {
        externalId: "r1",
        text: "Nice",
        authorName: "@a",
        authorExternalId: "u1",
        commentedAt: now,
        conversationId: "t-2",
      },
      {
        externalId: "r2",
        text: "Elsewhere",
        authorName: "@b",
        authorExternalId: "u2",
        commentedAt: now,
        conversationId: "other",
      },
    ] as never);
    provider.list.mockResolvedValueOnce([
      {
        externalId: "lc1",
        text: "Which chains?",
        authorName: "Ana",
        authorExternalId: "p9",
        commentedAt: now,
      },
    ] as never);

    await collectNewSocialComments({ projectId: "p-1", now });

    expect(db.postFindMany.mock.lastCall?.[0]?.where.provider).toEqual({
      in: ["instagram", "facebook", "youtube", "x", "linkedin", "tiktok"],
    });
    expect(provider.listX).toHaveBeenCalledTimes(1);
    expect(provider.list).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "linkedin",
        connectedAccountId: "zernio:acc-1",
      }),
      "z-1",
    );
    const saved = db.commentCreateMany.mock.calls.flatMap(
      ([args]) => args.data,
    );
    expect(
      saved.map((row) => [row.socialPostId, row.externalCommentId]),
    ).toEqual([
      ["li-1", "lc1"],
      ["x-2", "r1"],
    ]);
  });

  it("leaves out a LinkedIn profile connected through Composio, which cannot read comments", async () => {
    db.postFindMany.mockResolvedValueOnce([
      {
        id: "li-1",
        provider: "linkedin",
        publishedExternalId: "urn:li:share:1",
        socialConnectionId: "cl",
      },
    ] as never);
    db.connectionFindFirst.mockResolvedValue(connection("linkedin", "ca-li"));
    const result = await collectNewSocialComments({ projectId: "p-1", now });
    expect(provider.list).not.toHaveBeenCalled();
    expect(result.unavailable).toEqual([]);
  });

  it("hands Cuso only comments inside the comment window, so a backlog ages out", async () => {
    const now = new Date("2026-10-28T12:00:00.000Z");
    const since = new Date("2026-10-25T12:00:00.000Z");
    await collectNewSocialComments({ projectId: "p-1", now });
    expect(db.commentCount.mock.lastCall?.[0]?.where).toStrictEqual({
      projectId: "p-1",
      status: "REPLIED",
      handledAt: { gte: new Date("2026-10-27T12:00:00.000Z") },
    });
    expect(db.commentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: "p-1",
          status: "NEW",
          OR: [
            { commentedAt: { gte: since } },
            { commentedAt: null, createdAt: { gte: since } },
          ],
        },
      }),
    );
  });
});
