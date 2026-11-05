import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  commentFindFirst: vi.fn(),
  commentFindMany: vi.fn(async () => []),
  postFindMany: vi.fn(async () => []),
  commentCount: vi.fn(),
  commentUpdate: vi.fn(async () => ({})),
  commentUpdateMany: vi.fn(async () => ({ count: 1 })),
  connectionFindFirst: vi.fn(),
}));
const provider = vi.hoisted(() => ({ reply: vi.fn(async () => "r1") }));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    socialComment: {
      findFirst: db.commentFindFirst,
      findMany: db.commentFindMany,
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
}));
vi.mock("@/services/project-social-connections.service", () => ({
  projectExecutorUserId: () => "exec-1",
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
  socialPost: { socialConnectionId: "conn-1", provider: "instagram" },
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
      "ig-1",
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
  it("hands Cuso only comments inside the comment window, so a backlog ages out", async () => {
    const now = new Date("2026-10-28T12:00:00.000Z");
    const since = new Date("2026-10-25T12:00:00.000Z");
    await collectNewSocialComments({ projectId: "p-1", now });
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
