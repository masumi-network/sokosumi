import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { socialPostQuotedPostSchema } from "@/schemas/social-post.schema";
import {
  flagSocialPostQuotes,
  isSocialPostWaitingForQuote,
  mapSocialPostQuote,
  moveSocialPostQuotes,
  QUOTED_POST_CANCELLED,
  QUOTED_POST_FAILED,
  requireSocialPostQuote,
  socialPostQuotePublishDecision,
  socialPostQuoteSelect,
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

  it("waits indefinitely and doubles the delay up to five minutes", () => {
    let now = new Date(NOW.getTime() + 7 * 24 * 60 * 60_000);
    let lastAttemptAt: Date | null = null;
    let nextAttemptAt: Date | null = null;
    for (const delay of [60_000, 120_000, 240_000, 300_000, 300_000]) {
      const decision = socialPostQuotePublishDecision(
        { ...due, lastAttemptAt, nextAttemptAt },
        { status: "SCHEDULED", publishedExternalId: null },
        now,
      );
      expect(decision).toEqual({
        kind: "defer",
        retryAt: new Date(now.getTime() + delay),
      });
      lastAttemptAt = now;
      nextAttemptAt = new Date(now.getTime() + delay);
      now = nextAttemptAt;
    }
  });

  it("derives waiting only for due queued quotes with a pending dependency", () => {
    const post = { ...due, status: "SCHEDULED" as const };
    const target = {
      status: "NEEDS_APPROVAL" as const,
      publishedExternalId: null,
    };
    expect(isSocialPostWaitingForQuote(post, target, NOW)).toBe(true);
    expect(
      isSocialPostWaitingForQuote(post, target, new Date(NOW.getTime() - 1)),
    ).toBe(false);
    expect(
      isSocialPostWaitingForQuote(
        { ...post, status: "NEEDS_APPROVAL" },
        target,
        NOW,
      ),
    ).toBe(false);
    expect(
      isSocialPostWaitingForQuote(
        post,
        { ...target, publishedExternalId: "1907" },
        NOW,
      ),
    ).toBe(false);
    expect(
      isSocialPostWaitingForQuote(post, { ...target, status: "FAILED" }, NOW),
    ).toBe(false);
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
  function prepareQuotes(
    records: { id: string; quotedPostId: string; scheduledAt: Date }[],
  ) {
    findMany.mockImplementation(async ({ where }) =>
      records.filter(
        (quote) =>
          quote.quotedPostId === where.quotedPostId &&
          quote.scheduledAt <= where.scheduledAt.lte,
      ),
    );
  }

  it("moves a quote by its original gap and clears its old queue delay", async () => {
    prepareQuotes([
      {
        id: "quote",
        quotedPostId: "target",
        scheduledAt: new Date(NOW.getTime() + 120_000),
      },
    ]);
    const next = new Date(NOW.getTime() + 600_000);
    const scheduledAt = new Date(next.getTime() + 120_000);
    expect(
      await moveSocialPostQuotes(
        quoted,
        { provider: "x", scheduledAt: next },
        prisma,
      ),
    ).toEqual([{ id: "quote", scheduledAt }]);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "quote" },
      data: { scheduledAt, nextAttemptAt: null, revision: { increment: 1 } },
    });
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      projectId: "project",
      workspaceId: "workspace",
      publishedExternalId: null,
      status: { notIn: ["PUBLISHED", "CANCELED"] },
    });
  });

  it.each([null, NOW, new Date(NOW.getTime() + 60_000)])(
    "falls back to one minute for an unavailable or nonpositive gap (%s)",
    async (oldTime) => {
      prepareQuotes([
        { id: "quote", quotedPostId: "target", scheduledAt: NOW },
      ]);
      const next = new Date(NOW.getTime() + 600_000);
      expect(
        await moveSocialPostQuotes(
          { ...quoted, scheduledAt: oldTime },
          { provider: "x", scheduledAt: next },
          prisma,
        ),
      ).toEqual([
        { id: "quote", scheduledAt: new Date(next.getTime() + 60_000) },
      ]);
    },
  );

  it("moves chained quotes recursively and protects against cycles", async () => {
    prepareQuotes([
      {
        id: "quote",
        quotedPostId: "target",
        scheduledAt: new Date(NOW.getTime() + 60_000),
      },
      {
        id: "chain",
        quotedPostId: "quote",
        scheduledAt: new Date(NOW.getTime() + 180_000),
      },
      { id: "target", quotedPostId: "chain", scheduledAt: NOW },
    ]);
    const next = new Date(NOW.getTime() + 600_000);
    expect(
      await moveSocialPostQuotes(
        quoted,
        { provider: "x", scheduledAt: next },
        prisma,
      ),
    ).toEqual([
      { id: "quote", scheduledAt: new Date(next.getTime() + 60_000) },
      { id: "chain", scheduledAt: new Date(next.getTime() + 180_000) },
    ]);
    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it("leaves quotes already later in place", async () => {
    const next = new Date(NOW.getTime() + 600_000);
    prepareQuotes([
      {
        id: "quote",
        quotedPostId: "target",
        scheduledAt: new Date(next.getTime() + 1),
      },
    ]);
    expect(
      await moveSocialPostQuotes(
        quoted,
        { provider: "x", scheduledAt: next },
        prisma,
      ),
    ).toEqual([]);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("leaves schedules in place when the target stays, moves earlier, or is live", async () => {
    for (const scheduledAt of [NOW, new Date(NOW.getTime() - 1)]) {
      expect(
        await moveSocialPostQuotes(
          quoted,
          { provider: "x", scheduledAt },
          prisma,
        ),
      ).toEqual([]);
    }
    expect(
      await moveSocialPostQuotes(
        { ...quoted, publishedExternalId: "1907" },
        { provider: "x", scheduledAt: new Date(NOW.getTime() + 600_000) },
        prisma,
      ),
    ).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("prevents changing a quoted target to a non-X provider", async () => {
    findMany.mockResolvedValue([{ id: "quote" }]);
    await expect(
      moveSocialPostQuotes(
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

describe("quoted post response", () => {
  it("selects every account field the response schema requires", () => {
    const account = {
      id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
      externalHandle: "sokosumi",
      displayName: null,
      avatarUrl: null,
      subscriptionType: null,
      status: "active",
    };
    // Prisma only returns selected columns.
    const selected = Object.fromEntries(
      Object.keys(socialPostQuoteSelect.socialConnection.select).map((key) => [
        key,
        account[key as keyof typeof account],
      ]),
    ) as typeof account;

    const result = socialPostQuotedPostSchema.safeParse(
      mapSocialPostQuote({
        id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        projectId: "project",
        workspaceId: "workspace",
        provider: "x",
        status: "SCHEDULED",
        scheduledAt: NOW,
        timezone: null,
        publishedExternalId: null,
        publishedUrl: null,
        text: "Quoted",
        media: [],
        quotedPostId: null,
        socialConnection: selected,
      }),
    );

    expect(result.error?.issues).toBeUndefined();
  });
});
