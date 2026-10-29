import type {
  NewsletterSend,
  NewsletterSendingDomain,
  NewsletterSubscriber,
} from "@sokosumi/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import prisma from "@/lib/db/prisma";

import {
  NEWSLETTER,
  NEWSLETTER_ID,
  NEWSLETTER_ISSUE,
  NEWSLETTER_ISSUE_ID,
  NEWSLETTER_SUBSCRIBER,
} from "@/test/newsletter";

import {
  sendDueNewsletterIssues,
  sendNewsletterIssue,
} from "./newsletter-send.service";

const m = vi.hoisted(() => {
  const state: {
    domain?: string;
    subscribers: NewsletterSubscriber[];
    sends: NewsletterSend[];
    providerCounter: number;
    withdrewConsent: boolean;
    organizationSlug: string | null;
    sendingDomain: NewsletterSendingDomain | null;
    engagement: Map<string, Date>;
    adverseEvents: {
      sendId: string;
      type: "BOUNCED" | "COMPLAINED";
      bounceType: string | null;
      occurredAt: Date;
    }[];
  } = {
    domain: "news.example.com",
    subscribers: [],
    sends: [],
    providerCounter: 0,
    withdrewConsent: false,
    organizationSlug: "utxo",
    sendingDomain: null,
    engagement: new Map(),
    adverseEvents: [],
  };
  return {
    state,
    issueFindUnique: vi.fn(),
    issueFindMany: vi.fn(),
    issueUpdate: vi.fn(),
    subscriberFindMany: vi.fn(),
    reserve: vi.fn(),
    sendUpdate: vi.fn(),
    sendCount: vi.fn(),
    sendDelete: vi.fn(),
    sendFindMany: vi.fn(),
    transaction: vi.fn(),
    batchSend: vi.fn(),
    domainFind: vi.fn(),
    domainUpdate: vi.fn(),
    domainUpdateMany: vi.fn(),
  };
});

vi.mock("resend", () => ({
  Resend: class {
    batch = { send: m.batchSend };
  },
}));
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      NEWSLETTER_FROM_DOMAIN: m.state.domain,
    }),
    getBetterAuthPublicBaseUrl: () => "https://core.example.com",
  };
});
vi.mock("@/lib/db/prisma", () => ({
  default: {
    newsletterIssue: {
      findUnique: m.issueFindUnique,
      findMany: m.issueFindMany,
      updateMany: m.issueUpdate,
    },
    newsletterSubscriber: { findMany: m.subscriberFindMany },
    newsletterSend: {
      createManyAndReturn: m.reserve,
      updateMany: m.sendUpdate,
      count: m.sendCount,
      deleteMany: m.sendDelete,
      findMany: m.sendFindMany,
    },
    newsletterSendingDomain: {
      findUnique: m.domainFind,
      update: m.domainUpdate,
      updateMany: m.domainUpdateMany,
    },
    $transaction: m.transaction,
  },
}));

function subscribers(count: number): NewsletterSubscriber[] {
  return Array.from({ length: count }, (_, i) => ({
    ...NEWSLETTER_SUBSCRIBER,
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    email: `reader${i + 1}@example.com`,
  }));
}

function customDomain(
  overrides: Partial<NewsletterSendingDomain> = {},
): NewsletterSendingDomain {
  return {
    id: "custom-domain",
    workspaceId: NEWSLETTER.workspaceId,
    domain: "custom.example.com",
    fromAddress: "hello@custom.example.com",
    resendDomainId: "resend-domain",
    status: "VERIFIED",
    dnsRecords: [],
    lastCheckedAt: new Date(),
    failureReason: null,
    warmupStartedAt: new Date(),
    warmupPausedAt: null,
    warmupPauseReason: null,
    warmupSentOnDayUtc: null,
    warmupSentCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

interface SendWhere {
  id?: string | { in: string[] };
  issueId?: string;
  status?: string;
  sendingDomainId?: string;
  attemptedAt?: null | { not?: null; gte?: Date; lte?: Date };
  events?: {
    some: {
      type: string;
      bounceType?: { in: string[] };
      occurredAt: { gte: Date; lte: Date };
    };
  };
}

function matchesSend(row: NewsletterSend, where: SendWhere): boolean {
  if (where.issueId && row.issueId !== where.issueId) return false;
  if (where.status && row.status !== where.status) return false;
  if (where.sendingDomainId && row.sendingDomainId !== where.sendingDomainId)
    return false;
  if (typeof where.id === "string" && row.id !== where.id) return false;
  if (typeof where.id === "object" && !where.id.in.includes(row.id))
    return false;
  if (where.attemptedAt === null && row.attemptedAt !== null) return false;
  if (where.attemptedAt && row.attemptedAt === null) return false;
  if (where.attemptedAt?.gte && row.attemptedAt! < where.attemptedAt.gte)
    return false;
  if (where.attemptedAt?.lte && row.attemptedAt! > where.attemptedAt.lte)
    return false;
  if (where.events) {
    const filter = where.events.some;
    if (
      !m.state.adverseEvents.some(
        (event) =>
          event.sendId === row.id &&
          event.type === filter.type &&
          (!filter.bounceType ||
            filter.bounceType.in.includes(event.bounceType ?? "")) &&
          event.occurredAt >= filter.occurredAt.gte &&
          event.occurredAt <= filter.occurredAt.lte,
      )
    )
      return false;
  }
  return true;
}

function recoverIssue(id = NEWSLETTER_ISSUE_ID) {
  m.issueFindUnique.mockResolvedValue({
    ...NEWSLETTER_ISSUE,
    id,
    newsletter: NEWSLETTER,
    status: "SENDING",
    leaseToken: null,
    leaseExpiresAt: new Date(0),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  m.state.domain = "news.example.com";
  m.state.subscribers = subscribers(1);
  m.state.sends = [];
  m.state.providerCounter = 0;
  m.state.withdrewConsent = false;
  m.state.organizationSlug = "utxo";
  m.state.sendingDomain = null;
  m.state.engagement = new Map();
  m.state.adverseEvents = [];
  m.domainFind.mockImplementation(() =>
    m.state.sendingDomain ? { ...m.state.sendingDomain } : null,
  );
  m.domainUpdate.mockImplementation(
    ({ data }: { data: Partial<NewsletterSendingDomain> }) => {
      Object.assign(m.state.sendingDomain!, data);
      return m.state.sendingDomain;
    },
  );
  m.domainUpdateMany.mockImplementation(
    ({ data }: { data: Partial<NewsletterSendingDomain> }) => {
      if (!m.state.sendingDomain || m.state.sendingDomain.warmupPausedAt)
        return { count: 0 };
      Object.assign(m.state.sendingDomain, data);
      return { count: 1 };
    },
  );
  const issue = {
    ...NEWSLETTER_ISSUE,
    status: "SCHEDULED",
    newsletter: NEWSLETTER,
  };
  const matchesBeta = (where: {
    project?: { workspace: { organization: { slug: string } } };
  }) =>
    !where.project ||
    where.project.workspace.organization.slug === m.state.organizationSlug;
  m.issueFindUnique.mockImplementation(({ where }) =>
    matchesBeta(where) ? issue : null,
  );
  m.issueFindMany.mockImplementation(({ where }) =>
    matchesBeta(where) ? [{ id: NEWSLETTER_ISSUE_ID }] : [],
  );
  m.issueUpdate.mockImplementation(({ where }) => ({
    count: matchesBeta(where) ? 1 : 0,
  }));
  m.sendDelete.mockImplementation(
    ({ where }: { where: { id: { in: string[] }; status: string } }) => {
      const before = m.state.sends.length;
      m.state.sends = m.state.sends.filter(
        (send) =>
          !where.id.in.includes(send.id) || send.status !== where.status,
      );
      return { count: before - m.state.sends.length };
    },
  );
  m.subscriberFindMany.mockImplementation(
    ({ where }: { where: { id?: { gt?: string; in?: string[] } } }) => {
      const active = m.state.subscribers.filter(
        (subscriber) => subscriber.status === "ACTIVE",
      );
      const ids = where.id?.in;
      if (ids)
        return m.state.withdrewConsent
          ? []
          : active.filter((subscriber) => ids.includes(subscriber.id));
      const cursor = where.id?.gt;
      return active
        .filter((subscriber) => !cursor || subscriber.id > cursor)
        .slice(0, 100);
    },
  );
  m.reserve.mockImplementation(
    ({ data }: { data: { issueId: string; subscriberId: string }[] }) => {
      const created: NewsletterSend[] = [];
      for (const row of data) {
        if (
          m.state.sends.some(
            (send) =>
              send.issueId === row.issueId &&
              send.subscriberId === row.subscriberId,
          )
        )
          continue;
        const send: NewsletterSend = {
          ...row,
          id: `send-${row.issueId}-${row.subscriberId}`,
          status: "QUEUED",
          providerMessageId: null,
          sentAt: null,
          error: null,
          attemptedAt: null,
          sendingDomainId: null,
        };
        m.state.sends.push(send);
        created.push(send);
      }
      return created;
    },
  );
  m.sendUpdate.mockImplementation(
    ({ where, data }: { where: SendWhere; data: Partial<NewsletterSend> }) => {
      let count = 0;
      for (const row of m.state.sends) {
        if (!matchesSend(row, where)) continue;
        Object.assign(row, data);
        count++;
      }
      return { count };
    },
  );
  m.sendFindMany.mockImplementation(({ where }: { where: SendWhere }) =>
    m.state.sends
      .filter((row) => matchesSend(row, where))
      .map((row) => {
        const subscriber = m.state.subscribers.find(
          ({ id }) => id === row.subscriberId,
        )!;
        const engagedAt = m.state.engagement.get(subscriber.id);
        return {
          ...row,
          subscriber: {
            ...subscriber,
            events: engagedAt ? [{ occurredAt: engagedAt }] : [],
          },
        };
      }),
  );
  m.sendCount.mockImplementation(
    ({ where }: { where: SendWhere }) =>
      m.state.sends.filter((row) => matchesSend(row, where)).length,
  );
  m.transaction.mockImplementation(
    (
      operations:
        | Promise<unknown>[]
        | ((tx: typeof prisma) => Promise<unknown>),
    ) =>
      typeof operations === "function"
        ? operations(prisma)
        : Promise.all(operations),
  );
  m.batchSend.mockImplementation((inputs: unknown[]) => ({
    data: {
      data: inputs.map(() => ({ id: `provider-${++m.state.providerCounter}` })),
    },
    error: null,
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sendNewsletterIssue", () => {
  it("keeps recipients above a custom domain's daily cap queued", async () => {
    m.state.subscribers = subscribers(75);
    m.state.sendingDomain = customDomain();
    await sendNewsletterIssue(NEWSLETTER_ISSUE_ID);
    expect(m.state.sends.filter((send) => send.status === "SENT")).toHaveLength(
      50,
    );
    expect(
      m.state.sends.filter((send) => send.status === "QUEUED"),
    ).toHaveLength(25);
    expect(m.issueUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SENDING", leaseToken: null }),
      }),
    );
  });

  it("resumes the unsent remainder through the scheduler on the next UTC day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T23:59:00Z"));
    m.state.subscribers = subscribers(75);
    m.state.sendingDomain = customDomain();

    await sendNewsletterIssue(NEWSLETTER_ISSUE_ID);

    expect(m.state.sendingDomain.warmupSentCount).toBe(50);
    expect(m.issueUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SENDING",
          leaseExpiresAt: new Date("2026-10-30T00:00:00Z"),
        }),
      }),
    );
    const queued = m.state.sends.filter(({ status }) => status === "QUEUED");
    expect(queued).toHaveLength(25);
    expect(queued.every(({ attemptedAt }) => attemptedAt === null)).toBe(true);

    vi.setSystemTime(new Date("2026-10-30T00:00:00Z"));
    recoverIssue();
    await sendDueNewsletterIssues();

    expect(m.batchSend.mock.calls.map(([batch]) => batch.length)).toEqual([
      50, 25,
    ]);
    expect(
      m.state.sends.filter(({ status }) => status === "SENT"),
    ).toHaveLength(75);
    expect(m.state.sendingDomain.warmupSentCount).toBe(25);
    expect(m.state.sendingDomain.warmupSentOnDayUtc).toEqual(
      new Date("2026-10-30T00:00:00Z"),
    );
    expect(m.issueUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SENT" }),
      }),
    );
  });

  it("ranks engagement across all subscriber pages before spending the cap", async () => {
    m.state.subscribers = subscribers(150);
    m.state.sendingDomain = customDomain();
    m.state.engagement.set(
      m.state.subscribers[148]!.id,
      new Date("2026-10-28T12:00:00Z"),
    );
    m.state.engagement.set(
      m.state.subscribers[149]!.id,
      new Date("2026-10-29T12:00:00Z"),
    );
    m.state.subscribers[147]!.confirmedAt = new Date("2026-10-29T11:00:00Z");

    await sendNewsletterIssue(NEWSLETTER_ISSUE_ID);

    const delivered = m.batchSend.mock.calls[0]?.[0].map(
      (input: { to: string }) => input.to,
    );
    expect(delivered.slice(0, 4)).toEqual([
      "reader150@example.com",
      "reader149@example.com",
      "reader148@example.com",
      "reader1@example.com",
    ]);
    expect(delivered).toHaveLength(50);
    expect(
      m.state.sends.filter(({ status }) => status === "QUEUED"),
    ).toHaveLength(100);
    expect(m.sendFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          subscriber: {
            include: {
              events: {
                where: { type: { in: ["OPENED", "CLICKED"] } },
                orderBy: { occurredAt: "desc" },
                take: 1,
                select: { occurredAt: true },
              },
            },
          },
        },
      }),
    );
  });

  it("shares a domain's daily capacity across newsletter issues", async () => {
    m.state.subscribers = subscribers(40);
    m.state.sendingDomain = customDomain();
    await sendNewsletterIssue(NEWSLETTER_ISSUE_ID);
    const nextIssueId = "66666666-6666-4666-8666-666666666666";
    m.issueFindUnique.mockResolvedValue({
      ...NEWSLETTER_ISSUE,
      id: nextIssueId,
      newsletter: NEWSLETTER,
      status: "SCHEDULED",
    });

    await sendNewsletterIssue(nextIssueId);

    expect(m.batchSend.mock.calls.map(([batch]) => batch.length)).toEqual([
      40, 10,
    ]);
    expect(m.state.sendingDomain.warmupSentCount).toBe(50);
    expect(
      m.state.sends.filter(
        ({ issueId, status }) => issueId === nextIssueId && status === "QUEUED",
      ),
    ).toHaveLength(30);
    expect(
      m.state.sends
        .filter(({ status }) => status === "SENT")
        .every(
          ({ sendingDomainId, attemptedAt }) =>
            sendingDomainId === "custom-domain" && attemptedAt instanceof Date,
        ),
    ).toBe(true);
    expect(m.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("preserves all recipients when today's domain capacity is already used", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
    m.state.subscribers = subscribers(3);
    m.state.sendingDomain = customDomain({
      warmupSentOnDayUtc: new Date("2026-10-29T00:00:00Z"),
      warmupSentCount: 50,
    });

    await sendNewsletterIssue(NEWSLETTER_ISSUE_ID);

    expect(m.batchSend).not.toHaveBeenCalled();
    expect(m.state.sends).toHaveLength(3);
    expect(
      m.state.sends.every(
        ({ status, attemptedAt }) =>
          status === "QUEUED" && attemptedAt === null,
      ),
    ).toBe(true);
    expect(m.issueUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SENDING",
          lastError: expect.stringContaining("daily warm-up limit"),
        }),
      }),
    );
  });

  it("pauses when new attempts make an existing complaint reach the minimum sample", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
    m.state.sendingDomain = customDomain();
    m.state.subscribers = subscribers(20);
    await sendNewsletterIssue(NEWSLETTER_ISSUE_ID);
    m.state.adverseEvents.push({
      sendId: m.state.sends[0]!.id,
      type: "COMPLAINED",
      bounceType: null,
      occurredAt: new Date(),
    });
    expect(m.state.sendingDomain.warmupPausedAt).toBeNull();

    const nextIssueId = "66666666-6666-4666-8666-666666666666";
    m.state.subscribers = subscribers(60);
    m.issueFindUnique.mockResolvedValue({
      ...NEWSLETTER_ISSUE,
      id: nextIssueId,
      newsletter: NEWSLETTER,
      status: "SCHEDULED",
    });
    await sendNewsletterIssue(nextIssueId);

    expect(m.batchSend.mock.calls.map(([batch]) => batch.length)).toEqual([
      20, 30,
    ]);
    expect(m.state.sendingDomain).toMatchObject({
      warmupPausedAt: new Date(),
      warmupPauseReason: "COMPLAINT_RATE",
      warmupSentCount: 50,
    });
    expect(
      m.state.sends.filter(
        ({ issueId, status }) => issueId === nextIssueId && status === "QUEUED",
      ),
    ).toHaveLength(30);

    recoverIssue(nextIssueId);
    await sendNewsletterIssue(nextIssueId);

    expect(m.batchSend).toHaveBeenCalledTimes(2);
    expect(
      m.state.sends.filter(
        ({ issueId, status }) => issueId === nextIssueId && status === "QUEUED",
      ),
    ).toHaveLength(30);
  });

  it("keeps paused custom-domain recipients queued until an admin resumes it", async () => {
    m.state.subscribers = subscribers(3);
    m.state.sendingDomain = customDomain({
      warmupPausedAt: new Date(),
      warmupPauseReason: "COMPLAINT_RATE",
    });

    await sendNewsletterIssue(NEWSLETTER_ISSUE_ID);

    expect(m.batchSend).not.toHaveBeenCalled();
    expect(m.state.sends).toHaveLength(3);
    expect(
      m.state.sends.every(
        ({ status, attemptedAt }) =>
          status === "QUEUED" && attemptedAt === null,
      ),
    ).toBe(true);
    expect(m.issueUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SENDING",
          lastError: expect.stringContaining("paused"),
        }),
      }),
    );

    m.state.sendingDomain.warmupPausedAt = null;
    m.state.sendingDomain.warmupPauseReason = null;
    recoverIssue();
    await sendNewsletterIssue(NEWSLETTER_ISSUE_ID);

    expect(m.batchSend).toHaveBeenCalledOnce();
    expect(
      m.batchSend.mock.calls[0]?.[0].every((input: { from: string }) =>
        input.from.includes("hello@custom.example.com"),
      ),
    ).toBe(true);
    expect(m.state.sends.every(({ status }) => status === "SENT")).toBe(true);
  });

  it("stops the next batch if a webhook pauses the domain during dispatch", async () => {
    m.state.subscribers = subscribers(250);
    m.state.sendingDomain = customDomain({
      warmupStartedAt: new Date(Date.now() - 7 * 86_400_000),
    });
    const acceptedBatch = m.batchSend.getMockImplementation()!;
    m.batchSend.mockImplementationOnce((...args) => {
      const result = acceptedBatch(...args);
      m.state.sendingDomain!.warmupPausedAt = new Date();
      m.state.sendingDomain!.warmupPauseReason = "BOUNCE_RATE";
      return result;
    });

    await sendNewsletterIssue(NEWSLETTER_ISSUE_ID);

    expect(m.batchSend).toHaveBeenCalledOnce();
    expect(
      m.state.sends.filter(({ status }) => status === "SENT"),
    ).toHaveLength(100);
    const queued = m.state.sends.filter(({ status }) => status === "QUEUED");
    expect(queued).toHaveLength(150);
    expect(queued.every(({ attemptedAt }) => attemptedAt === null)).toBe(true);
    expect(m.state.sendingDomain.warmupSentCount).toBe(100);
    expect(m.issueUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SENDING",
          lastError: expect.stringContaining("paused"),
        }),
      }),
    );
  });

  it("sends the full list after a custom domain reaches unlimited capacity", async () => {
    m.state.subscribers = subscribers(250);
    m.state.sendingDomain = customDomain({
      warmupStartedAt: new Date(Date.now() - 28 * 86_400_000),
      warmupSentCount: 10_000,
    });

    await sendNewsletterIssue(NEWSLETTER_ISSUE_ID);

    expect(m.batchSend.mock.calls.map(([batch]) => batch.length)).toEqual([
      100, 100, 50,
    ]);
    expect(m.state.sends.every(({ status }) => status === "SENT")).toBe(true);
  });

  it("retains safe queued reservations across a deadline before any provider attempt", async () => {
    m.state.subscribers = subscribers(3);
    const shouldContinue = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValue(false);

    await sendNewsletterIssue(NEWSLETTER_ISSUE_ID, { shouldContinue });

    expect(m.batchSend).not.toHaveBeenCalled();
    expect(m.state.sends).toHaveLength(3);
    expect(
      m.state.sends.every(
        ({ status, attemptedAt }) =>
          status === "QUEUED" && attemptedAt === null,
      ),
    ).toBe(true);
    recoverIssue();
    await sendNewsletterIssue(NEWSLETTER_ISSUE_ID);
    expect(m.batchSend.mock.calls[0]?.[0]).toHaveLength(3);
    expect(m.state.sends.every(({ status }) => status === "SENT")).toBe(true);
  });

  it("does not spend domain capacity when the lease is lost before reservation", async () => {
    m.state.sendingDomain = customDomain();
    m.issueUpdate
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValue({ count: 0 });

    await expect(
      sendNewsletterIssue(NEWSLETTER_ISSUE_ID),
    ).rejects.toMatchObject({ status: 409 });

    expect(m.batchSend).not.toHaveBeenCalled();
    expect(m.state.sendingDomain.warmupSentCount).toBe(0);
    expect(m.domainUpdate).not.toHaveBeenCalled();
    expect(m.state.sends[0]).toMatchObject({
      status: "QUEUED",
      attemptedAt: null,
    });
  });

  it("sends 250 active subscribers in three private batches with signed links and headers", async () => {
    m.state.subscribers = subscribers(250);
    await sendNewsletterIssue(NEWSLETTER_ISSUE_ID);
    expect(m.batchSend.mock.calls.map(([batch]) => batch.length)).toEqual([
      100, 100, 50,
    ]);
    expect(m.subscriberFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          newsletterId: NEWSLETTER_ID,
          status: "ACTIVE",
          id: { gt: m.state.subscribers[99]!.id },
        },
        orderBy: { id: "asc" },
        take: 100,
      }),
    );
    const first = m.batchSend.mock.calls[0]?.[0][0];
    const second = m.batchSend.mock.calls[0]?.[0][1];
    expect(first).toMatchObject({
      to: "reader1@example.com",
      from: '"Ada via Sokosumi" <newsletter@news.example.com>',
      replyTo: "ada@example.com",
      subject: NEWSLETTER_ISSUE.subject,
      headers: {
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        "List-Unsubscribe": expect.stringMatching(
          /^<https:\/\/core\.example\.com\/v1\/public\/newsletter\/unsubscribe\?token=/,
        ),
      },
      text: expect.stringContaining("unsubscribe?token="),
      html: expect.stringContaining("unsubscribe?token="),
    });
    expect(first.headers["List-Unsubscribe"]).not.toEqual(
      second.headers["List-Unsubscribe"],
    );
    expect(m.state.sends).toHaveLength(250);
    expect(m.domainUpdate).not.toHaveBeenCalled();
    expect(
      m.state.sends.every(
        (row) => row.status === "SENT" && row.providerMessageId && row.sentAt,
      ),
    ).toBe(true);
    expect(m.issueUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "SENDING",
          leaseToken: expect.any(String),
        }),
        data: expect.objectContaining({
          status: "SENT",
          sentAt: expect.any(Date),
          leaseToken: null,
        }),
      }),
    );
  });

  it("skips pending, unsubscribed and bounced subscribers", async () => {
    m.state.subscribers = subscribers(4).map((subscriber, i) => ({
      ...subscriber,
      status: (["ACTIVE", "PENDING", "UNSUBSCRIBED", "BOUNCED"] as const)[i]!,
    }));
    await sendNewsletterIssue(NEWSLETTER_ISSUE_ID);
    expect(m.batchSend.mock.calls[0]?.[0]).toHaveLength(1);
    expect(m.state.sends).toHaveLength(1);
    expect(m.subscriberFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          newsletterId: NEWSLETTER_ID,
          status: "ACTIVE",
        }),
      }),
    );
  });

  it("rechecks consent before the provider call", async () => {
    m.state.withdrewConsent = true;
    await sendNewsletterIssue(NEWSLETTER_ISSUE_ID);
    expect(m.batchSend).not.toHaveBeenCalled();
    expect(m.state.sends[0]).toMatchObject({
      status: "FAILED",
      error: "Subscriber is no longer active",
    });
  });

  it("refuses without a newsletter sending domain before claiming or sending", async () => {
    m.state.domain = undefined;
    await expect(sendNewsletterIssue(NEWSLETTER_ISSUE_ID)).rejects.toThrow(
      "Connect a sending domain",
    );
    expect(m.issueUpdate).not.toHaveBeenCalled();
    expect(m.batchSend).not.toHaveBeenCalled();
  });

  it("recovers unattempted deliveries after the deadline while retaining ambiguous reservations", async () => {
    m.state.subscribers = subscribers(3);
    const existing: NewsletterSend = {
      id: "previous-reservation",
      issueId: NEWSLETTER_ISSUE_ID,
      subscriberId: m.state.subscribers[0]!.id,
      status: "QUEUED",
      providerMessageId: null,
      sentAt: null,
      error: null,
      attemptedAt: new Date(),
      sendingDomainId: null,
    };
    m.state.sends = [existing];
    const shouldContinue = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    await sendNewsletterIssue(NEWSLETTER_ISSUE_ID, { shouldContinue });
    expect(m.batchSend).not.toHaveBeenCalled();
    expect(m.state.sends).toHaveLength(3);
    expect(m.state.sends).toContain(existing);
    expect(
      m.state.sends.filter((send) => send.status === "QUEUED"),
    ).toHaveLength(2);
    expect(m.issueUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SENT" }),
      }),
    );
    m.issueFindUnique.mockResolvedValue({
      ...NEWSLETTER_ISSUE,
      newsletter: NEWSLETTER,
      status: "SENDING",
      leaseToken: "expired-lease",
      leaseExpiresAt: new Date(0),
    });
    await sendNewsletterIssue(NEWSLETTER_ISSUE_ID);
    expect(m.batchSend).toHaveBeenCalledOnce();
    expect(
      m.batchSend.mock.calls[0]?.[0].map((email: { to: string }) => email.to),
    ).toEqual(["reader2@example.com", "reader3@example.com"]);
    expect(m.state.sends.filter((send) => send.status === "SENT")).toHaveLength(
      2,
    );
    expect(existing.status).toBe("FAILED");
  });

  it.each(["other", null])(
    "refuses a project's non-beta workspace (%s) before claiming",
    async (slug) => {
      m.state.organizationSlug = slug;
      await expect(
        sendNewsletterIssue(NEWSLETTER_ISSUE_ID),
      ).rejects.toMatchObject({ status: 404 });
      expect(m.issueUpdate).not.toHaveBeenCalled();
      expect(m.reserve).not.toHaveBeenCalled();
      expect(m.batchSend).not.toHaveBeenCalled();
    },
  );

  it("stops dispatch when the project's workspace leaves beta during rendering", async () => {
    const reserve = m.reserve.getMockImplementation()!;
    m.reserve.mockImplementationOnce((...args) => {
      const result = reserve(...args);
      m.state.organizationSlug = "other";
      return result;
    });
    await expect(
      sendNewsletterIssue(NEWSLETTER_ISSUE_ID),
    ).rejects.toMatchObject({ status: 409 });
    expect(m.batchSend).not.toHaveBeenCalled();
  });

  it("fails an issue with no active subscribers without calling the provider", async () => {
    m.state.subscribers = [];
    await sendNewsletterIssue(NEWSLETTER_ISSUE_ID);
    expect(m.batchSend).not.toHaveBeenCalled();
    expect(m.issueUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          lastError: expect.stringContaining("No active subscribers"),
        }),
      }),
    );
  });

  it("never resends existing sent, failed, or attempted reservations", async () => {
    m.state.subscribers = subscribers(5);
    m.state.sends = m.state.subscribers.slice(0, 3).map((subscriber, i) => ({
      id: `existing-${i}`,
      issueId: NEWSLETTER_ISSUE_ID,
      subscriberId: subscriber.id,
      status: (["SENT", "FAILED", "QUEUED"] as const)[i]!,
      providerMessageId: i === 0 ? "previous-provider-id" : null,
      sentAt: i === 0 ? new Date() : null,
      error: null,
      attemptedAt: new Date(),
      sendingDomainId: null,
    }));
    await sendNewsletterIssue(NEWSLETTER_ISSUE_ID);
    expect(
      m.batchSend.mock.calls[0]?.[0].map((email: { to: string }) => email.to),
    ).toEqual(["reader4@example.com", "reader5@example.com"]);
    expect(
      m.state.sends.find((send) => send.id === "existing-0")?.providerMessageId,
    ).toBe("previous-provider-id");
    expect(m.state.sends.find((send) => send.id === "existing-2")?.status).toBe(
      "FAILED",
    );
  });

  it("records provider failures and fails an issue when no recipient was sent", async () => {
    m.batchSend.mockResolvedValue({
      data: null,
      error: {
        name: "provider_error",
        message: "Provider unavailable",
        statusCode: 503,
      },
    });
    await sendNewsletterIssue(NEWSLETTER_ISSUE_ID);
    expect(m.state.sends[0]).toMatchObject({
      status: "FAILED",
      error: "Provider unavailable",
    });
    expect(m.issueUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          lastError: "Provider unavailable",
          sentAt: null,
        }),
      }),
    );
  });

  it("marks attempted rows failed after delivery persistence fails and never sends them again", async () => {
    m.state.subscribers = subscribers(3);
    const update = m.sendUpdate.getMockImplementation()!;
    m.sendUpdate.mockImplementation((args) => {
      if (args.data.status === "SENT") {
        throw new Error("Delivery persistence unavailable");
      }
      return update(args);
    });

    await sendNewsletterIssue(NEWSLETTER_ISSUE_ID);

    expect(m.batchSend).toHaveBeenCalledOnce();
    expect(m.state.sends).toHaveLength(3);
    expect(
      m.state.sends.every(
        ({ attemptedAt, status }) =>
          attemptedAt instanceof Date && status === "FAILED",
      ),
    ).toBe(true);
    expect(
      m.state.sends.every(
        ({ error }) => error === "Delivery persistence unavailable",
      ),
    ).toBe(true);

    m.sendUpdate.mockImplementation(update);
    recoverIssue();
    await sendNewsletterIssue(NEWSLETTER_ISSUE_ID);

    expect(m.batchSend).toHaveBeenCalledOnce();
    expect(m.state.sends.every(({ status }) => status === "FAILED")).toBe(true);
  });

  it("continues later batches after a provider failure and keeps their ids", async () => {
    m.state.subscribers = subscribers(250);
    m.batchSend.mockResolvedValueOnce({
      data: null,
      error: {
        name: "provider_error",
        message: "Batch failed",
        statusCode: 503,
      },
    });
    await sendNewsletterIssue(NEWSLETTER_ISSUE_ID);
    expect(m.state.sends.filter((send) => send.status === "SENT")).toHaveLength(
      150,
    );
    expect(
      m.state.sends.filter((send) => send.status === "FAILED"),
    ).toHaveLength(100);
    expect(m.issueUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SENT",
          lastError: "Batch failed",
        }),
      }),
    );
  });

  it("requires SCHEDULED unless the trusted caller explicitly allows another status", async () => {
    m.issueFindUnique.mockResolvedValue({
      ...NEWSLETTER_ISSUE,
      newsletter: NEWSLETTER,
    });
    await expect(
      sendNewsletterIssue(NEWSLETTER_ISSUE_ID),
    ).rejects.toMatchObject({ status: 409 });
    expect(m.batchSend).not.toHaveBeenCalled();
    await sendNewsletterIssue(NEWSLETTER_ISSUE_ID, { allowedStatus: "DRAFT" });
    expect(m.batchSend).toHaveBeenCalledOnce();
  });

  it("does not dispatch after losing the claim or lease", async () => {
    m.issueUpdate.mockResolvedValueOnce({ count: 0 });
    await expect(
      sendNewsletterIssue(NEWSLETTER_ISSUE_ID),
    ).rejects.toMatchObject({ status: 409 });
    m.issueUpdate
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValue({ count: 0 });
    await expect(
      sendNewsletterIssue(NEWSLETTER_ISSUE_ID),
    ).rejects.toMatchObject({ status: 409 });
    expect(m.batchSend).not.toHaveBeenCalled();
  });

  it("recovers expired sending leases, but refuses a live lease", async () => {
    m.issueFindUnique.mockResolvedValue({
      ...NEWSLETTER_ISSUE,
      newsletter: NEWSLETTER,
      status: "SENDING",
      leaseToken: "old-lease",
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    await expect(
      sendNewsletterIssue(NEWSLETTER_ISSUE_ID),
    ).rejects.toMatchObject({ status: 409 });
    m.issueFindUnique.mockResolvedValue({
      ...NEWSLETTER_ISSUE,
      newsletter: NEWSLETTER,
      status: "SENDING",
      leaseToken: "old-lease",
      leaseExpiresAt: new Date(0),
    });
    await sendNewsletterIssue(NEWSLETTER_ISSUE_ID);
    expect(m.issueUpdate.mock.calls[0]?.[0].where).toMatchObject({
      status: "SENDING",
      leaseToken: "old-lease",
    });
    expect(m.batchSend).toHaveBeenCalledOnce();
  });
});

describe("newsletter scheduler", () => {
  it("selects due scheduled issues and expired leases, and obeys the cron deadline", async () => {
    await sendDueNewsletterIssues({ shouldContinue: () => false });
    expect(m.issueFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          project: { workspace: { organization: { slug: "utxo" } } },
          OR: [
            { status: "SCHEDULED", scheduledAt: { lte: expect.any(Date) } },
            { status: "SENDING", leaseExpiresAt: { lte: expect.any(Date) } },
          ],
        },
      }),
    );
    expect(m.batchSend).not.toHaveBeenCalled();
    await sendDueNewsletterIssues();
    expect(m.batchSend).toHaveBeenCalledOnce();
  });

  it.each(["other", null])(
    "skips due issues outside the project beta workspace (%s)",
    async (slug) => {
      m.state.organizationSlug = slug;
      await sendDueNewsletterIssues();
      expect(m.issueFindUnique).not.toHaveBeenCalled();
      expect(m.batchSend).not.toHaveBeenCalled();
    },
  );
});
