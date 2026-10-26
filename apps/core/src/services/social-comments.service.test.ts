import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  commentFindFirst: vi.fn(),
  commentCount: vi.fn(),
  commentUpdate: vi.fn(async () => ({})),
  connectionFindFirst: vi.fn(),
}));
const provider = vi.hoisted(() => ({ reply: vi.fn(async () => "r1") }));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    socialComment: {
      findFirst: db.commentFindFirst,
      count: db.commentCount,
      update: db.commentUpdate,
    },
    projectSocialConnection: { findFirst: db.connectionFindFirst },
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
    expect(db.commentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "REPLIED",
          replyExternalId: "r1",
        }),
      }),
    );
  });

  it("never answers a comment twice", async () => {
    db.commentFindFirst.mockResolvedValue(comment({ status: "REPLIED" }));
    await expect(reply()).rejects.toThrow("handled already");
    expect(provider.reply).not.toHaveBeenCalled();
  });

  it("stops at the day's cap", async () => {
    db.commentCount.mockResolvedValueOnce(SOCIAL_REPLIES_PER_DAY);
    await expect(reply()).rejects.toThrow("today's last reply");
    expect(provider.reply).not.toHaveBeenCalled();
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
    expect(db.commentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "OWNER",
          note: "Asks for a refund",
        }),
      }),
    );
  });
});
