import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import {
  flagSocialPostQuotes,
  QUOTED_POST_CANCELLED,
  QUOTED_POST_FAILED,
  QUOTED_POST_WAIT_EXPIRED,
  requireSocialPostQuote,
  requireSocialPostQuotingPosts,
  SOCIAL_POST_QUOTE_WAIT_MS,
  socialPostQuotePublishDecision,
} from "./social-post-quote";

const { findFirst, findMany, updateMany } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { socialPost: { findFirst, findMany, updateMany } },
}));

const NOW = new Date("2026-10-26T10:00:00Z");
const quoted = {
  id: "target",
  projectId: "project",
  workspaceId: "workspace",
  provider: "x",
  status: "SCHEDULED",
  scheduledAt: NOW,
  publishedExternalId: null,
  quotedPostId: null,
};
const input = {
  postId: "quote",
  projectId: "project",
  workspaceId: "workspace",
  provider: "x",
  quotedPostId: "target",
  scheduledAt: new Date(NOW.getTime() + 60_000),
};
const due = {
  quotedPostId: "target",
  needsAttentionReason: null,
  publishedExternalId: null,
  scheduledAt: NOW,
};

beforeEach(() => {
  vi.resetAllMocks();
  findFirst.mockResolvedValue(quoted);
  findMany.mockResolvedValue([]);
  updateMany.mockResolvedValue({ count: 1 });
});

describe("quote validation", () => {
  it("scopes the target to the same project and workspace and rejects a missing/cross-project post", async () => {
    findFirst.mockResolvedValue(null);
    await expect(requireSocialPostQuote(input, prisma)).rejects.toMatchObject({
      status: 400,
      message: "The quoted post must belong to the same project",
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "target", projectId: "project", workspaceId: "workspace" },
      }),
    );
  });

  it("rejects a non-X quoting post", async () => {
    await expect(
      requireSocialPostQuote({ ...input, provider: "linkedin" }, prisma),
    ).rejects.toMatchObject({
      status: 400,
      message: "Only X posts can quote another post",
    });
  });

  it("rejects a non-X target", async () => {
    findFirst.mockResolvedValue({ ...quoted, provider: "linkedin" });
    await expect(requireSocialPostQuote(input, prisma)).rejects.toMatchObject({
      status: 400,
      message: "The quoted post must target X",
    });
  });

  it("rejects quoting itself", async () => {
    await expect(
      requireSocialPostQuote({ ...input, quotedPostId: "quote" }, prisma),
    ).rejects.toMatchObject({
      status: 400,
      message: "A post cannot quote itself",
    });
  });

  it("rejects a two-post cycle", async () => {
    findFirst
      .mockResolvedValueOnce({ ...quoted, quotedPostId: "quote" })
      .mockResolvedValueOnce({ id: "quote", quotedPostId: "target" });
    await expect(requireSocialPostQuote(input, prisma)).rejects.toMatchObject({
      status: 400,
      message: "Posts cannot form a quote cycle",
    });
  });

  it("rejects a longer cycle and a pre-existing cycle in the target chain", async () => {
    findFirst
      .mockResolvedValueOnce({ ...quoted, quotedPostId: "third" })
      .mockResolvedValueOnce({ id: "third", quotedPostId: "target" });
    await expect(requireSocialPostQuote(input, prisma)).rejects.toMatchObject({
      status: 400,
      message: "Posts cannot form a quote cycle",
    });
  });

  it.each([-1, 0])(
    "requires a time strictly after the target (%s ms)",
    async (offset) => {
      await expect(
        requireSocialPostQuote(
          { ...input, scheduledAt: new Date(NOW.getTime() + offset) },
          prisma,
        ),
      ).rejects.toMatchObject({
        status: 400,
        message: `This quote must be scheduled strictly after the quoted post at ${NOW.toISOString()}`,
      });
    },
  );

  it.each(["DRAFT", "NEEDS_APPROVAL", "SCHEDULED"])(
    "enforces order for a %s target",
    async (status) => {
      findFirst.mockResolvedValue({ ...quoted, status });
      await requireSocialPostQuote(input, prisma);
      await expect(
        requireSocialPostQuote({ ...input, scheduledAt: NOW }, prisma),
      ).rejects.toMatchObject({ status: 400 });
    },
  );

  it("keeps unscheduled drafts but requires the target's time before scheduling", async () => {
    findFirst.mockResolvedValue({
      ...quoted,
      status: "DRAFT",
      scheduledAt: null,
    });
    await requireSocialPostQuote({ ...input, scheduledAt: null }, prisma);
    await expect(requireSocialPostQuote(input, prisma)).rejects.toMatchObject({
      status: 400,
      message: "Schedule the quoted post before scheduling this quote",
    });
  });

  it("rejects post now until the target is live", async () => {
    await expect(
      requireSocialPostQuote({ ...input, publishNow: true }, prisma),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("quoted post is not live yet"),
    });
  });

  it.each(["PUBLISHED", "PUBLISHING", "FAILED"])(
    "uses a confirmed head even when the target thread is %s",
    async (status) => {
      findFirst.mockResolvedValue({
        ...quoted,
        status,
        publishedExternalId: "1907",
      });
      await requireSocialPostQuote(
        { ...input, scheduledAt: NOW, publishNow: true },
        prisma,
      );
    },
  );

  it("keeps cancellation/deletion blocked until the quote is explicitly repaired", async () => {
    await expect(
      requireSocialPostQuote(
        { ...input, needsAttentionReason: QUOTED_POST_CANCELLED },
        prisma,
      ),
    ).rejects.toMatchObject({ status: 400, message: QUOTED_POST_CANCELLED });
    await expect(
      requireSocialPostQuote(
        {
          ...input,
          quotedPostId: null,
          needsAttentionReason: QUOTED_POST_CANCELLED,
        },
        prisma,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await requireSocialPostQuote(
      { ...input, quotedPostId: null, needsAttentionReason: null },
      prisma,
    );
  });

  it.each(["FAILED", "MISSED", "PUBLISHED"])(
    "blocks a %s target missing its head",
    async (status) => {
      findFirst.mockResolvedValue({ ...quoted, status });
      await expect(requireSocialPostQuote(input, prisma)).rejects.toMatchObject(
        { status: 400, message: QUOTED_POST_FAILED },
      );
    },
  );
});

describe("quote publishing decisions", () => {
  it("uses the confirmed first part of a partially failed thread", () => {
    expect(
      socialPostQuotePublishDecision(
        due,
        { status: "FAILED", publishedExternalId: "1907" },
        NOW,
      ),
    ).toEqual({ kind: "ready", externalId: "1907" });
  });

  it.each(["SCHEDULED", "NEEDS_APPROVAL", "PUBLISHING"] as const)(
    "defers a %s dependency for a minute without a provider call",
    (status) => {
      expect(
        socialPostQuotePublishDecision(
          due,
          { status, publishedExternalId: null },
          NOW,
        ),
      ).toEqual({ kind: "defer", retryAt: new Date(NOW.getTime() + 60_000) });
    },
  );

  it("caps the last retry at 30 minutes and then needs attention", () => {
    const deadline = new Date(NOW.getTime() + SOCIAL_POST_QUOTE_WAIT_MS);
    expect(
      socialPostQuotePublishDecision(
        due,
        { status: "SCHEDULED", publishedExternalId: null },
        new Date(deadline.getTime() - 1),
      ),
    ).toEqual({ kind: "defer", retryAt: deadline });
    expect(
      socialPostQuotePublishDecision(
        due,
        { status: "SCHEDULED", publishedExternalId: null },
        deadline,
      ),
    ).toEqual({ kind: "blocked", reason: QUOTED_POST_WAIT_EXPIRED });
  });

  it.each(["FAILED", "MISSED", "PUBLISHED"] as const)(
    "needs attention when %s has no first part",
    (status) => {
      expect(
        socialPostQuotePublishDecision(
          due,
          { status, publishedExternalId: null },
          NOW,
        ),
      ).toEqual({ kind: "blocked", reason: QUOTED_POST_FAILED });
    },
  );

  it.each(["CANCELED", "DRAFT"] as const)(
    "blocks a target moved to %s",
    (status) => {
      expect(
        socialPostQuotePublishDecision(
          due,
          { status, publishedExternalId: null },
          NOW,
        ),
      ).toEqual({ kind: "blocked", reason: QUOTED_POST_CANCELLED });
    },
  );

  it("retains a deleted target's reason after SET NULL", () => {
    expect(
      socialPostQuotePublishDecision(
        {
          ...due,
          quotedPostId: null,
          needsAttentionReason: QUOTED_POST_CANCELLED,
        },
        null,
        NOW,
      ),
    ).toEqual({ kind: "blocked", reason: QUOTED_POST_CANCELLED });
  });

  it("resumes an already-published quoting thread without checking its old quote", () => {
    expect(
      socialPostQuotePublishDecision(
        {
          ...due,
          publishedExternalId: "1908",
          needsAttentionReason: QUOTED_POST_CANCELLED,
        },
        null,
        NOW,
      ),
    ).toEqual({ kind: "ready" });
  });
});

describe("quote dependents", () => {
  it("blocks a later/equal target schedule and lists every conflicting quote", async () => {
    findMany.mockResolvedValue([
      { id: "quote", text: "Launch", scheduledAt: NOW },
      { id: "other", text: "Followup", scheduledAt: NOW },
    ]);
    await expect(
      requireSocialPostQuotingPosts(
        { ...quoted, publishedExternalId: null },
        { provider: "x", scheduledAt: NOW },
        prisma,
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining(
        `Post quote (Launch) quotes this post and is scheduled at ${NOW.toISOString()}; move it first. Post other`,
      ),
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          quotedPostId: "target",
          scheduledAt: { lte: NOW },
        }),
      }),
    );
  });

  it("allows an earlier target schedule or retry of a target whose head is already live", async () => {
    await requireSocialPostQuotingPosts(
      quoted,
      { provider: "x", scheduledAt: NOW },
      prisma,
    );
    findMany.mockClear();
    await requireSocialPostQuotingPosts(
      { ...quoted, publishedExternalId: "1907" },
      { provider: "x", scheduledAt: NOW },
      prisma,
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it("prevents changing a quoted target to a non-X provider", async () => {
    findMany.mockResolvedValue([{ id: "quote" }]);
    await expect(
      requireSocialPostQuotingPosts(
        quoted,
        { provider: "linkedin", scheduledAt: null },
        prisma,
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "This post must target X because other posts quote it",
    });
  });

  it("flags queued posts as FAILED and preserves approval on drafts", async () => {
    findMany.mockResolvedValue([
      { id: "draft", status: "DRAFT" },
      { id: "agent", status: "NEEDS_APPROVAL" },
      { id: "quote", status: "SCHEDULED" },
    ]);
    await flagSocialPostQuotes("target", QUOTED_POST_CANCELLED, prisma);
    expect(updateMany).toHaveBeenCalledTimes(2);
    const draftData = updateMany.mock.calls[0][0].data;
    expect(draftData).not.toHaveProperty("status");
    expect(draftData).toMatchObject({
      needsAttentionReason: QUOTED_POST_CANCELLED,
      leaseToken: null,
      nextAttemptAt: null,
    });
    expect(updateMany.mock.calls[1][0]).toMatchObject({
      where: {
        quotedPostId: "target",
        publishedExternalId: null,
        id: { in: ["quote"] },
      },
      data: { status: "FAILED", lastError: QUOTED_POST_CANCELLED },
    });
  });
});
