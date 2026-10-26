import { randomUUID } from "node:crypto";
import type { NewsletterSubscriber } from "@sokosumi/database";
import { SOKO_BOT_TOOL_INPUT_SCHEMAS } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTION_CAPABILITIES,
  EXTERNAL_EFFECT_CAPABILITIES,
} from "@/lib/soko-bot/action-receipts";
import { ACTION_LABELS } from "@/lib/soko-bot/action-response";
import { newsletterConsentSchema } from "@/schemas/newsletter.schema";
import {
  NEWSLETTER,
  NEWSLETTER_PROJECT_ID,
  NEWSLETTER_SUBSCRIBER,
  NEWSLETTER_WORKSPACE_ID,
} from "@/test/newsletter";

// The Subscribers page's services run for real against these mocks; only the
// database, the contact links, Jev and the outgoing email are stand-ins.
const m = vi.hoisted(() => ({
  access: vi.fn(),
  available: vi.fn(),
  ownerTurn: vi.fn(),
  jev: vi.fn(),
  receipt: vi.fn(),
  receiptUpdate: vi.fn(),
  finish: vi.fn(),
  turn: vi.fn(),
  workspace: vi.fn(),
  query: vi.fn(),
  reserve: vi.fn(),
  count: vi.fn(),
  link: vi.fn(),
  suppressed: vi.fn(),
  createSubscribers: vi.fn(),
  events: vi.fn(),
  subscriber: vi.fn(),
  updateSubscriber: vi.fn(),
  deleteSubscribers: vi.fn(),
  contacts: vi.fn(),
  confirm: vi.fn(),
  sendEmail: vi.fn(),
  sendEmails: vi.fn(),
  csv: vi.fn(),
}));
vi.mock("@/config/env", () => ({
  getEnv: () => ({ NEWSLETTER_ENABLED: true }),
  getWebAppBaseUrl: () => "https://app.example.com",
}));
vi.mock("@/lib/redis", () => ({ getRedisClient: () => null }));
vi.mock("@/lib/soko-bot/jev", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  evaluateWithJev: m.jev,
}));
vi.mock("@/clients/email.client", () => ({
  RESEND_BATCH_MAX_SIZE: 100,
  sendEmail: m.sendEmail,
  sendEmails: m.sendEmails,
}));
vi.mock("@/services/newsletter-signup.service", () => ({
  sendNewsletterConfirmations: m.confirm,
}));
vi.mock("@/services/newsletter-contacts.service", () => ({
  linkNewsletterContacts: m.link,
}));
vi.mock("@/services/contacts.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveContactSummaries: async () => new Map(),
  contactListWhere: async () => ({ id: "in-list" }),
}));
const subscribers = {
  findUnique: m.subscriber,
  update: m.updateSubscriber,
  deleteMany: m.deleteSubscribers,
  findMany: m.suppressed,
  createManyAndReturn: m.createSubscribers,
};
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotToolCall: { findUnique: m.receipt, updateMany: m.finish },
    sokoBotTurn: { findUnique: m.ownerTurn },
    newsletter: { findUnique: async () => NEWSLETTER },
    // Pending confirmations re-checked before sending.
    newsletterSubscriber: { findMany: async () => [] },
    contact: { findMany: m.contacts },
  },
}));
vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: m.access,
}));
vi.mock("@/services/project-social-connections.service", () => ({
  requireScopedProject: async () => {},
}));
vi.mock("@/services/newsletter-draft.service", () => ({
  isNewsletterDraftAvailable: m.available,
}));
vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: async (
    operation: (tx: unknown) => Promise<unknown>,
  ) =>
    operation({
      $queryRaw: m.query,
      workspace: { findFirst: m.workspace },
      sokoBotTurn: { findFirst: m.turn, findUnique: async () => null },
      sokoBotToolCall: {
        findUnique: m.receipt,
        create: m.reserve,
        count: m.count,
        update: m.receiptUpdate,
      },
      newsletter: { findUnique: async () => NEWSLETTER },
      newsletterSubscriber: subscribers,
      newsletterEvent: { createMany: m.events },
    }),
}));

import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeService,
} from "./soko-bot-runtime.service";

const BOT_ID = "77777777-7777-4777-8777-777777777777";
const SUBSCRIBER_ID = NEWSLETTER_SUBSCRIBER.id;
const SUBSCRIBERS_URL = `/projects/${NEWSLETTER_PROJECT_ID}/newsletter/subscribers`;
const AUTHORIZED: AuthorizedSokoBotRuntime = {
  turn: {
    id: "turn",
    sokoBotId: BOT_ID,
    actingUserId: "user",
    requestedByUserId: "user",
    workspaceId: NEWSLETTER_WORKSPACE_ID,
    eveSessionId: "session",
    versionId: null,
    source: "CHAT",
    chainDepth: 0,
  },
  grant: {
    userId: "user",
    sokoBotId: BOT_ID,
    workspaceId: NEWSLETTER_WORKSPACE_ID,
    issuer: "core",
    audience: "soko-bot",
    subject: BOT_ID,
    jwtId: "grant",
    sessionId: "session",
    turnId: "turn",
    contextSnapshotId: "snapshot",
    memoryRevisionId: null,
    memoryVersion: 0,
    capabilities: [
      "add_newsletter_subscriber",
      "import_newsletter_subscribers",
      "add_newsletter_subscribers_from_contacts",
      "update_newsletter_subscriber",
      "remove_newsletter_subscriber",
    ],
    issuedAt: 0,
    expiresAt: Date.now() + 60_000,
  },
  reader: { userId: "user", audience: "OWNER", sharedScope: null },
  classificationConfidence: 1,
  toolCallLimit: 10,
  askedByKind: "OWNER",
};

type Capability =
  | "add_newsletter_subscriber"
  | "import_newsletter_subscribers"
  | "add_newsletter_subscribers_from_contacts"
  | "update_newsletter_subscriber"
  | "remove_newsletter_subscriber";

const CALLS: Record<Capability, Record<string, unknown>> = {
  add_newsletter_subscriber: { email: "ada@example.com", consent: "ASK" },
  import_newsletter_subscribers: { fileId: "file-1", consent: "ASK" },
  add_newsletter_subscribers_from_contacts: {
    contactListIds: [randomUUID()],
    consent: "ASK",
  },
  update_newsletter_subscriber: {
    subscriberId: SUBSCRIBER_ID,
    status: "UNSUBSCRIBED",
  },
  remove_newsletter_subscriber: { subscriberId: SUBSCRIBER_ID },
};

function execute(
  capability: Capability,
  input: Record<string, unknown> = CALLS[capability],
  authorized = AUTHORIZED,
) {
  const runtime = new SokoBotRuntimeService();
  vi.spyOn(runtime, "authorize").mockResolvedValue(authorized);
  vi.spyOn(
    runtime as unknown as { readCsvFile: (...args: unknown[]) => unknown },
    "readCsvFile",
  ).mockImplementation(m.csv);
  return runtime.executeTool({
    sessionId: "session",
    turnId: "turn",
    toolCallId: `call-${capability}`,
    capability,
    input: { projectId: NEWSLETTER_PROJECT_ID, ...input },
  });
}

/** The owner typed this turn in their own chat. */
function ownerTurn(userMessage: string, parentTurnId: string | null = null) {
  m.ownerTurn.mockResolvedValue({
    source: "CHAT",
    parentTurnId,
    askedByUserId: null,
    chainDepth: 0,
    chatMentionId: "mention",
    userMessage,
  });
}

function jevSays(probability: number) {
  m.jev.mockResolvedValue({
    answers: new Map([["said", { type: "boolean", probability }]]),
    costUsd: 0,
  });
}

function csvOf(count: number) {
  return [
    "email,name",
    ...Array.from({ length: count }, (_, i) => `p${i}@example.com,P${i}`),
  ].join("\n");
}

function expectNothingWritten() {
  expect(m.createSubscribers).not.toHaveBeenCalled();
  expect(m.updateSubscriber).not.toHaveBeenCalled();
  expect(m.deleteSubscribers).not.toHaveBeenCalled();
  expect(m.receiptUpdate).not.toHaveBeenCalled();
  expect(m.confirm).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  m.access.mockResolvedValue({
    projectId: NEWSLETTER_PROJECT_ID,
    workspaceId: NEWSLETTER_WORKSPACE_ID,
    userId: "user",
    organizationId: null,
  });
  m.available.mockResolvedValue(true);
  ownerTurn("Please add ada@example.com to the newsletter");
  m.receipt.mockResolvedValue(null);
  m.receiptUpdate.mockResolvedValue({});
  m.finish.mockResolvedValue({ count: 1 });
  m.count.mockResolvedValue(0);
  m.turn.mockResolvedValue({
    id: "turn",
    sokoBot: { id: BOT_ID, userId: "user", projectId: null, workspaceId: null },
  });
  m.workspace.mockResolvedValue({
    id: NEWSLETTER_WORKSPACE_ID,
    organizationId: null,
  });
  m.link.mockImplementation(
    async (_tx, _id, _actor, people: { email: string }[]) =>
      new Map(people.map(({ email }) => [email, { id: `contact-${email}` }])),
  );
  m.suppressed.mockResolvedValue([]);
  m.createSubscribers.mockImplementation(
    async ({ data }: { data: Partial<NewsletterSubscriber>[] }) =>
      data.map((row) => ({
        ...NEWSLETTER_SUBSCRIBER,
        ...row,
        name: row.name ?? null,
        id: randomUUID(),
      })),
  );
  m.events.mockResolvedValue({ count: 0 });
  m.subscriber.mockResolvedValue(NEWSLETTER_SUBSCRIBER);
  m.updateSubscriber.mockImplementation(async ({ data }) => ({
    ...NEWSLETTER_SUBSCRIBER,
    status: data.status ?? NEWSLETTER_SUBSCRIBER.status,
  }));
  m.deleteSubscribers.mockResolvedValue({ count: 1 });
  m.csv.mockResolvedValue(csvOf(2));
});

describe("Soko Bot newsletter subscriber tools", () => {
  it("are actions with labels, consented like the Subscribers page", () => {
    for (const capability of Object.keys(CALLS)) {
      expect(ACTION_CAPABILITIES.has(capability)).toBe(true);
      expect(EXTERNAL_EFFECT_CAPABILITIES.has(capability)).toBe(false);
      expect(ACTION_LABELS[capability]).toBeTruthy();
    }
    expect(
      SOKO_BOT_TOOL_INPUT_SCHEMAS.add_newsletter_subscriber.shape.consent
        .options,
    ).toEqual(newsletterConsentSchema.options);
  });

  it("asks one person first, and emails them only after the receipt commits", async () => {
    const result = await execute("add_newsletter_subscriber");
    expect(m.createSubscribers.mock.calls[0]?.[0].data).toEqual([
      expect.objectContaining({
        email: "ada@example.com",
        status: "PENDING",
        source: "MANUAL",
      }),
    ]);
    expect(result).toMatchObject({
      email: "ada@example.com",
      status: "PENDING",
      projectId: NEWSLETTER_PROJECT_ID,
      url: SUBSCRIBERS_URL,
    });
    expect(m.receiptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorBotId: BOT_ID,
          targetId: (result as { id: string }).id,
          disposition: "APPLIED",
        }),
      }),
    );
    expect(m.confirm).toHaveBeenCalledTimes(1);
    expect(m.confirm.mock.invocationCallOrder[0]).toBeGreaterThan(
      m.receiptUpdate.mock.invocationCallOrder[0] ?? Infinity,
    );
    // Consent was not claimed, so nobody judged the owner's words.
    expect(m.jev).not.toHaveBeenCalled();
    expect(m.sendEmail).not.toHaveBeenCalled();
    expect(m.sendEmails).not.toHaveBeenCalled();
  });

  it("records consent when the owner says the person agreed", async () => {
    ownerTurn("Ada signed up at our booth, add her as confirmed");
    jevSays(0.95);
    const result = await execute("add_newsletter_subscriber", {
      email: "ada@example.com",
      name: "Ada",
      consent: "CONFIRMED",
    });
    expect(m.jev.mock.calls[0]?.[0].state).toEqual({
      ownerMessage: "Ada signed up at our booth, add her as confirmed",
      people: "Ada ada@example.com",
    });
    expect(result).toMatchObject({ status: "ACTIVE" });
    expect(m.confirm).not.toHaveBeenCalled();
  });

  it("never lets the bot vouch for consent itself", async () => {
    jevSays(0.3);
    await expect(
      execute("add_newsletter_subscriber", {
        email: "ada@example.com",
        consent: "CONFIRMED",
      }),
    ).rejects.toThrow("Only the owner can say people already agreed");
    expectNothingWritten();
  });

  it("does not take a background run's brief as the owner's word on consent", async () => {
    ownerTurn("They all agreed", "parent-turn");
    jevSays(0.99);
    await expect(
      execute("import_newsletter_subscribers", {
        fileId: "file-1",
        consent: "CONFIRMED",
      }),
    ).rejects.toThrow("Only the owner can say people already agreed");
    expect(m.jev).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it.each(Object.keys(CALLS) as Capability[])(
    "refuses %s in a turn Core started",
    async (capability) => {
      m.ownerTurn.mockResolvedValue({
        source: "SCHEDULE",
        parentTurnId: null,
        askedByUserId: null,
        chainDepth: 0,
        chatMentionId: null,
        userMessage: "They all agreed",
      });
      await expect(execute(capability)).rejects.toThrow(
        "only when the owner asks in their chat",
      );
      expectNothingWritten();
    },
  );

  it.each(Object.keys(CALLS) as Capability[])(
    "keeps %s from shared bots and teammates",
    async (capability) => {
      await expect(
        execute(capability, CALLS[capability], {
          ...AUTHORIZED,
          askedByKind: "TEAMMATE",
          reader: {
            userId: "teammate",
            audience: "TEAMMATE",
            sharedScope: null,
          },
        }),
      ).rejects.toThrow("personal data");
      expect(m.access).not.toHaveBeenCalled();
      expectNothingWritten();
    },
  );

  it("imports a small CSV on the owner's word, asking each person first", async () => {
    const result = await execute("import_newsletter_subscribers");
    expect(m.csv).toHaveBeenCalledWith(AUTHORIZED, "file-1");
    expect(m.createSubscribers.mock.calls[0]?.[0].data).toHaveLength(2);
    expect(result).toMatchObject({
      imported: 2,
      pendingConfirmation: 2,
      url: SUBSCRIBERS_URL,
    });
    expect(m.receiptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ targetId: NEWSLETTER.id }),
      }),
    );
    expect(m.confirm.mock.calls[0]?.[1]).toHaveLength(2);
  });

  it("refuses a CSV of more than 100 people before writing or emailing", async () => {
    m.csv.mockResolvedValue(csvOf(101));
    await expect(execute("import_newsletter_subscribers")).rejects.toThrow(
      "at most 100 can be added at a time here. Add more from the Newsletter's Subscribers page",
    );
    expect(m.link).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("counts contacts after expanding lists, and refuses past 100", async () => {
    m.contacts.mockResolvedValue(
      Array.from({ length: 101 }, (_, i) => ({
        id: randomUUID(),
        name: `P${i}`,
        channels: [{ value: `p${i}@example.com` }],
      })),
    );
    await expect(
      execute("add_newsletter_subscribers_from_contacts"),
    ).rejects.toThrow("This adds 101 people");
    expect(m.link).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("adds contacts from a list with a receipt", async () => {
    m.contacts.mockResolvedValue([
      {
        id: randomUUID(),
        name: "Ada",
        channels: [{ value: "ada@example.com" }],
      },
      { id: randomUUID(), name: "No email", channels: [] },
    ]);
    const result = await execute("add_newsletter_subscribers_from_contacts");
    expect(result).toMatchObject({
      added: 1,
      skippedNoEmail: 1,
      pendingConfirmation: 1,
      url: SUBSCRIBERS_URL,
    });
    expect(m.receiptUpdate).toHaveBeenCalledTimes(1);
  });

  it("never re-subscribes someone who unsubscribed, and keeps no receipt", async () => {
    m.suppressed.mockResolvedValue([
      {
        status: "UNSUBSCRIBED",
        contact: { id: "contact-ada@example.com", mergedIntoId: null },
      },
    ]);
    m.createSubscribers.mockResolvedValue([]);
    await expect(execute("add_newsletter_subscriber")).rejects.toThrow(
      "they cannot be subscribed again",
    );
    expect(m.receiptUpdate).not.toHaveBeenCalled();
    expect(m.confirm).not.toHaveBeenCalled();
  });

  it("unsubscribes an active subscriber with a receipt", async () => {
    const result = await execute("update_newsletter_subscriber");
    expect(m.updateSubscriber.mock.calls[0]?.[0].data).toMatchObject({
      status: "UNSUBSCRIBED",
    });
    expect(result).toMatchObject({
      id: SUBSCRIBER_ID,
      status: "UNSUBSCRIBED",
      url: SUBSCRIBERS_URL,
    });
    expect(m.receiptUpdate).toHaveBeenCalledTimes(1);
  });

  it("cannot set someone who unsubscribed back to ACTIVE", async () => {
    m.subscriber.mockResolvedValue({
      ...NEWSLETTER_SUBSCRIBER,
      status: "UNSUBSCRIBED",
    });
    await expect(
      execute("update_newsletter_subscriber", {
        subscriberId: SUBSCRIBER_ID,
        status: "ACTIVE",
      }),
    ).rejects.toThrow("cannot change status manually");
    expectNothingWritten();
  });

  it("removes a subscriber on the owner's word with a receipt", async () => {
    const result = await execute("remove_newsletter_subscriber");
    expect(m.deleteSubscribers).toHaveBeenCalledWith({
      where: {
        id: SUBSCRIBER_ID,
        newsletterId: NEWSLETTER.id,
        status: { in: ["ACTIVE", "PENDING"] },
      },
    });
    expect(result).toEqual({
      id: SUBSCRIBER_ID,
      projectId: NEWSLETTER_PROJECT_ID,
      removed: true,
      url: SUBSCRIBERS_URL,
    });
    expect(m.receiptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ targetId: SUBSCRIBER_ID }),
      }),
    );
  });

  it("runs only where the newsletter is enabled", async () => {
    m.available.mockResolvedValue(false);
    await expect(execute("add_newsletter_subscriber")).rejects.toThrow(
      "Newsletter is not enabled",
    );
    expectNothingWritten();
  });
});
