import type { NewsletterSend, NewsletterSubscriber } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    enabled: boolean;
    domain?: string;
    subscribers: NewsletterSubscriber[];
    sends: NewsletterSend[];
    providerCounter: number;
    withdrewConsent: boolean;
    organizationSlug: string | null;
  } = {
    enabled: true,
    domain: "news.example.com",
    subscribers: [],
    sends: [],
    providerCounter: 0,
    withdrewConsent: false,
    organizationSlug: "utxo",
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
    transaction: vi.fn(),
    batchSend: vi.fn(),
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
      NEWSLETTER_ENABLED: m.state.enabled,
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

beforeEach(() => {
  vi.resetAllMocks();
  m.state.enabled = true;
  m.state.domain = "news.example.com";
  m.state.subscribers = subscribers(1);
  m.state.sends = [];
  m.state.providerCounter = 0;
  m.state.withdrewConsent = false;
  m.state.organizationSlug = "utxo";
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
          id: `send-${row.subscriberId}`,
          status: "QUEUED",
          providerMessageId: null,
          sentAt: null,
          error: null,
        };
        m.state.sends.push(send);
        created.push(send);
      }
      return created;
    },
  );
  m.sendUpdate.mockImplementation(
    ({
      where,
      data,
    }: {
      where: { id?: string | { in: string[] }; status?: string };
      data: Partial<NewsletterSend>;
    }) => {
      let count = 0;
      for (const row of m.state.sends) {
        if (where.status && row.status !== where.status) continue;
        if (typeof where.id === "string" && row.id !== where.id) continue;
        if (typeof where.id === "object" && !where.id.in.includes(row.id))
          continue;
        Object.assign(row, data);
        count++;
      }
      return { count };
    },
  );
  m.sendCount.mockImplementation(
    ({ where }: { where: { status: string } }) =>
      m.state.sends.filter((row) => row.status === where.status).length,
  );
  m.transaction.mockImplementation((operations: Promise<unknown>[]) =>
    Promise.all(operations),
  );
  m.batchSend.mockImplementation((inputs: unknown[]) => ({
    data: {
      data: inputs.map(() => ({ id: `provider-${++m.state.providerCounter}` })),
    },
    error: null,
  }));
});

describe("sendNewsletterIssue", () => {
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
      from: '"Ada" <newsletter@news.example.com>',
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
      "NEWSLETTER_FROM_DOMAIN",
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
    };
    m.state.sends = [existing];
    const shouldContinue = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    await sendNewsletterIssue(NEWSLETTER_ISSUE_ID, { shouldContinue });
    expect(m.batchSend).not.toHaveBeenCalled();
    expect(m.state.sends).toEqual([existing]);
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

  it("never resends existing sent, failed, or queued reservations", async () => {
    m.state.subscribers = subscribers(5);
    m.state.sends = m.state.subscribers.slice(0, 3).map((subscriber, i) => ({
      id: `existing-${i}`,
      issueId: NEWSLETTER_ISSUE_ID,
      subscriberId: subscriber.id,
      status: (["SENT", "FAILED", "QUEUED"] as const)[i]!,
      providerMessageId: i === 0 ? "previous-provider-id" : null,
      sentAt: i === 0 ? new Date() : null,
      error: null,
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
  it("does no work while disabled", async () => {
    m.state.enabled = false;
    await sendDueNewsletterIssues();
    await expect(
      sendNewsletterIssue(NEWSLETTER_ISSUE_ID),
    ).rejects.toMatchObject({ status: 404 });
    expect(m.issueFindMany).not.toHaveBeenCalled();
    expect(m.batchSend).not.toHaveBeenCalled();
  });

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
