/**
 * Automatic capture against a real database: recorded Gmail, Google Calendar
 * and Slack payloads go in through mocked Composio reads, and contacts,
 * channels, interactions, "known by" and the derived dates come out. Covers
 * idempotency, a backfill that resumes after a failure, merges and the
 * enrichment pass. No Composio or model call leaves the process.
 *
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/core test src/services/contact-capture.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import gmailReceived from "@/lib/contacts/__fixtures__/gmail-received.json";
import gmailSent from "@/lib/contacts/__fixtures__/gmail-sent.json";
import googleEvents from "@/lib/contacts/__fixtures__/googlecalendar-events.json";
import slack from "@/lib/contacts/__fixtures__/slack.json";

const mocks = vi.hoisted(() => ({
  fetchInboxPage: vi.fn(),
  fetchCalendarPage: vi.fn(),
  runIntegrationTool: vi.fn(),
  judgeRoleInboxes: vi.fn(),
  judgeListMemberships: vi.fn(),
  generateText: vi.fn(),
}));
vi.mock("@/lib/contacts/list-judge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/contacts/list-judge")>()),
  judgeListMemberships: mocks.judgeListMemberships,
}));
vi.mock("@/services/soko-bot-integrations.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/soko-bot-integrations.service")
  >()),
  fetchInboxPage: mocks.fetchInboxPage,
  fetchCalendarPage: mocks.fetchCalendarPage,
  runIntegrationTool: mocks.runIntegrationTool,
}));
vi.mock("@/lib/contacts/capture-judge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/contacts/capture-judge")>()),
  judgeRoleInboxes: mocks.judgeRoleInboxes,
}));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: mocks.generateText,
}));

import prisma from "@/lib/db/prisma";
import {
  ContactCaptureService,
  scheduleContactCapture,
} from "./contact-capture.service";
import {
  emptyEnrichmentStats,
  enrichWorkspaceContacts,
} from "./contact-enrichment.service";
import { createContactList } from "./contact-lists.service";
import {
  type ContactActor,
  findDuplicateContacts,
  inContactTransaction,
  upsertContact,
} from "./contacts.service";
import { contactLinesByEmail } from "./contacts-context.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const NOW = new Date("2026-10-21T12:00:00Z");
const alice = randomUUID();
const bob = randomUUID();
const organizationId = randomUUID();
const workspaceId = randomUUID();
const backfillWorkspaceId = randomUUID();
const mergeWorkspaceId = randomUUID();
const classifyWorkspaceId = randomUUID();
const classifyOrganizationId = randomUUID();
const guardWorkspaceId = randomUUID();
const guardOrganizationId = randomUUID();
const OWNER_EMAIL = "patrick@yellowhouse.gmbh";
const TEAMMATE_EMAIL = "bob@yellowhouse.gmbh";

function service(limits: Record<string, number> = {}) {
  return new ContactCaptureService({
    now: () => NOW,
    sleep: async () => undefined,
    // Other suites' queued contacts are not this run's to enrich.
    limits: {
      backfillDays: 30,
      pagesPerIntegration: 20,
      enrichmentWorkspaces: 0,
      ...limits,
    },
  });
}

function gmailPage(options: { query?: string; pageToken?: string }) {
  if (options.query?.startsWith("in:sent"))
    return options.pageToken
      ? { messages: [], raw: [], nextPageToken: null }
      : {
          messages: [],
          raw: gmailSent.messages,
          nextPageToken: gmailSent.nextPageToken,
        };
  return { messages: [], raw: gmailReceived.messages, nextPageToken: null };
}

function slackTool(
  _integration: unknown,
  tool: string,
  args: { channel?: string; user?: string },
) {
  switch (tool) {
    case "SLACK_TEST_AUTH":
      return slack.authTest;
    case "SLACK_LIST_CONVERSATIONS":
      return slack.conversations;
    case "SLACK_RETRIEVE_CONVERSATION_MEMBERS_LIST":
      return slack.members[args.channel as keyof typeof slack.members];
    case "SLACK_FETCH_CONVERSATION_HISTORY":
      return (
        slack.history[args.channel as keyof typeof slack.history] ?? {
          messages: [],
        }
      );
    case "SLACK_RETRIEVE_DETAILED_USER_INFORMATION":
      return slack.users[args.user as keyof typeof slack.users];
    default:
      throw new Error(`unexpected tool ${tool}`);
  }
}

async function contactsOf(id: string) {
  return prisma.contact.findMany({
    where: { workspaceId: id, mergedIntoId: null },
    include: {
      channels: { orderBy: { createdAt: "asc" } },
      interactions: { orderBy: { occurredAt: "asc" } },
    },
    orderBy: { name: "asc" },
  });
}

async function addBot(workspace: string, providers: string[]) {
  const bot = await prisma.sokoBot.create({
    data: { userId: alice, workspaceId: workspace },
  });
  for (const provider of providers)
    await prisma.sokoBotIntegration.create({
      data: {
        sokoBotId: bot.id,
        provider,
        composioAccountId: `ca_${randomUUID()}`,
        status: "ACTIVE",
      },
    });
  return bot;
}

describe.runIf(enabled)("contact capture on PostgreSQL", () => {
  let botId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: [OWNER_EMAIL, TEAMMATE_EMAIL] } },
    });
    for (const [id, name, email] of [
      [alice, "Alice Owner", OWNER_EMAIL],
      [bob, "Bob Teammate", TEAMMATE_EMAIL],
    ])
      await prisma.user.create({
        data: {
          id,
          name,
          email,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Capture",
        slug: `capture-${organizationId}`,
      },
    });
    await prisma.member.createMany({
      data: [alice, bob].map((userId) => ({ userId, organizationId })),
    });
    await prisma.workspace.create({
      data: { id: workspaceId, organizationId },
    });
    await prisma.workspace.create({
      data: { id: backfillWorkspaceId, userId: alice },
    });
    await prisma.workspace.create({
      data: { id: mergeWorkspaceId, userId: bob },
    });
    await prisma.organization.create({
      data: {
        id: classifyOrganizationId,
        name: "Classify",
        slug: `classify-${classifyOrganizationId}`,
      },
    });
    await prisma.member.create({
      data: { userId: bob, organizationId: classifyOrganizationId },
    });
    await prisma.workspace.create({
      data: { id: classifyWorkspaceId, organizationId: classifyOrganizationId },
    });
    botId = (await addBot(workspaceId, ["gmail", "googlecalendar", "slack"]))
      .id;
  });

  afterAll(async () => {
    const workspaces = [
      workspaceId,
      backfillWorkspaceId,
      mergeWorkspaceId,
      classifyWorkspaceId,
      guardWorkspaceId,
    ];
    await prisma.sokoBot.deleteMany({
      where: { workspaceId: { in: workspaces } },
    });
    await prisma.contactList.deleteMany({
      where: { workspaceId: { in: workspaces } },
    });
    await prisma.contact.deleteMany({
      where: { workspaceId: { in: workspaces } },
    });
    await prisma.workspace.deleteMany({ where: { id: { in: workspaces } } });
    await prisma.organization.deleteMany({
      where: {
        id: {
          in: [organizationId, guardOrganizationId, classifyOrganizationId],
        },
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: [alice, bob] } } });
  });

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.fetchInboxPage.mockImplementation(async (_integration, options) =>
      gmailPage(options),
    );
    mocks.fetchCalendarPage.mockImplementation(async (_integration, options) =>
      options.pageToken
        ? { events: [], raw: [], nextPageToken: null }
        : {
            events: [],
            raw: googleEvents.items,
            nextPageToken: googleEvents.nextPageToken,
          },
    );
    mocks.runIntegrationTool.mockImplementation(async (...args: unknown[]) =>
      slackTool(
        args[0],
        args[1] as string,
        args[2] as { channel?: string; user?: string },
      ),
    );
    // support@ is a queue, not a person.
    mocks.judgeRoleInboxes.mockImplementation(async (samples: unknown[]) =>
      samples.map(() => 0.2),
    );
    mocks.generateText.mockResolvedValue({ text: "{}", providerMetadata: {} });
    mocks.judgeListMemberships.mockResolvedValue(new Map());
  });

  it("captures people from sent and answered mail, meetings and Slack, with the teammate who had them", async () => {
    const run = await service().captureWorkspace(workspaceId, () => true);
    expect(run.capture).toMatchObject({
      integrations: 3,
      failed: 0,
      errors: [],
      unsupported: [],
      backfillsCompleted: 3,
    });

    const contacts = await contactsOf(workspaceId);
    expect(contacts.map((contact) => contact.name).sort()).toEqual(
      ["Lukas Meier", "Max Muster", "Nina Keller", "Tom Berger", "Sara"].sort(),
    );
    const nina = contacts.find((contact) => contact.name === "Nina Keller");
    expect(nina).toMatchObject({
      organization: "Acme Robotics AG",
      role: "Head of Partnerships",
      createdBySokoBotId: botId,
      createdByUserId: alice,
      interactionCount: 4,
      firstContactAt: new Date("2026-10-14T08:00:00Z"),
      lastContactAt: new Date("2026-10-20T12:00:00Z"),
    });
    // One person, every way to reach them, each marked with where it came from.
    expect(
      nina?.channels.map(({ type, value, source, verified }) => ({
        type,
        value,
        source,
        verified,
      })),
    ).toEqual([
      {
        type: "EMAIL",
        value: "nina.keller@acme-robotics.com",
        source: "EMAIL",
        verified: false,
      },
      {
        type: "PHONE",
        value: "+41791234567",
        source: "EMAIL",
        verified: false,
      },
      {
        type: "LINKEDIN",
        value: "https://www.linkedin.com/in/ninakeller",
        source: "EMAIL",
        verified: false,
      },
      {
        type: "SLACK",
        value: "T0ACME:U0NINA",
        source: "SLACK",
        verified: true,
      },
    ]);
    expect(
      nina?.interactions.map(
        ({ channel, direction, summary, userId, sokoBotId }) => ({
          channel,
          direction,
          summary,
          userId,
          sokoBotId,
        }),
      ),
    ).toEqual([
      {
        channel: "MEETING",
        direction: "BOTH",
        summary: "Pilot kickoff with Acme",
        userId: alice,
        sokoBotId: botId,
      },
      {
        channel: "EMAIL",
        direction: "IN",
        summary: "Pilot pricing for Q3",
        userId: alice,
        sokoBotId: botId,
      },
      {
        channel: "EMAIL",
        direction: "OUT",
        summary: "Pilot pricing for Q3",
        userId: alice,
        sokoBotId: botId,
      },
      {
        channel: "SLACK",
        direction: "BOTH",
        summary: "Slack direct message",
        userId: alice,
        sokoBotId: botId,
      },
    ]);
    const lukas = contacts.find((contact) => contact.name === "Lukas Meier");
    expect(lukas).toMatchObject({ role: "CTO" });
    expect(lukas?.channels.map((channel) => channel.type)).toEqual([
      "SLACK",
      "PHONE",
    ]);
    expect(lukas?.interactions[0]).toMatchObject({
      channel: "SLACK",
      summary: "Slack in #acme-pilot",
    });

    const addresses = (
      await prisma.contactChannel.findMany({
        where: { workspaceId, type: "EMAIL" },
      })
    ).map((channel) => channel.value);
    for (const never of [
      OWNER_EMAIL,
      TEAMMATE_EMAIL,
      "support@vendor-saas.io",
      "hello@weeklyfounder.com",
      "lena@shopper-deals.com",
      "cold@prospecting-agency.com",
      "notifications@github.com",
      "mailer-daemon@googlemail.com",
      "c_1888abc@resource.calendar.google.com",
      "lukas@acme-robotics.com",
      "p01@bigpartner.com",
      "a01@x.com",
      "anna@client.ch",
      "organizer@partner.org",
      "rep@vendor.com",
      "investor@vc.fund",
    ])
      expect(addresses).not.toContain(never);
    expect(mocks.judgeRoleInboxes).toHaveBeenCalledWith([
      expect.objectContaining({ email: "support@vendor-saas.io" }),
    ]);

    const state = await prisma.contactCaptureState.findMany({
      where: { integration: { sokoBotId: botId } },
    });
    expect(state).toHaveLength(3);
    expect(state.every((row) => row.backfillCompletedAt !== null)).toBe(true);

    const lines = await contactLinesByEmail({
      workspaceId,
      emails: ["Nina.Keller@acme-robotics.com", "stranger@x.com"],
      timeZone: "Europe/Zurich",
    });
    expect([...lines.keys()]).toEqual(["nina.keller@acme-robotics.com"]);
    expect(lines.get("nina.keller@acme-robotics.com")).toMatch(
      /^Nina Keller — Head of Partnerships @ Acme Robotics AG · contact · known by Alice Owner \(4\) · last: 20 Oct 2026, Alice Owner, Slack "Slack direct message" \(contact [0-9a-f-]+\)$/,
    );
  });

  it("captures nothing twice when the same mail, meetings and Slack are read again", async () => {
    const before = await prisma.contactInteraction.count({
      where: { workspaceId },
    });
    const contactCount = (await contactsOf(workspaceId)).length;
    await service().sync({ shouldContinue: () => true });
    await service().sync({ shouldContinue: () => true });
    expect(
      await prisma.contactInteraction.count({ where: { workspaceId } }),
    ).toBe(before);
    expect((await contactsOf(workspaceId)).length).toBe(contactCount);
    const nina = (await contactsOf(workspaceId)).find(
      (c) => c.name === "Nina Keller",
    );
    expect(nina?.interactionCount).toBe(4);
  });

  it("resumes an interrupted backfill on the page it did not finish, and completes it once", async () => {
    const bot = await addBot(backfillWorkspaceId, ["gmail"]);
    const sentCalls: string[] = [];
    let failOnCall = 3;
    mocks.fetchInboxPage.mockImplementation(async (_integration, options) => {
      const before: Date = options.before;
      const forward =
        before.getTime() === NOW.getTime() &&
        !options.pageToken &&
        options.since.getTime() > NOW.getTime() - 86_400_000;
      if (!options.query?.startsWith("in:sent") || forward)
        return { messages: [], raw: [], nextPageToken: null };
      const key = `${before.toISOString().slice(0, 10)}:${options.pageToken ?? "p1"}`;
      sentCalls.push(key);
      if (sentCalls.length === failOnCall) throw new Error("Composio timeout");
      const at = new Date(
        before.getTime() - (options.pageToken ? 2 : 1) * 86_400_000,
      );
      return {
        messages: [],
        raw: [
          {
            messageId: `m-${key}`,
            messageTimestamp: at.toISOString(),
            sender: OWNER_EMAIL,
            to: `Pat Partner <pat@partner-${before.toISOString().slice(0, 10)}.com>`,
            subject: `Window ${key}`,
          },
        ],
        nextPageToken: options.pageToken ? null : "p2",
      };
    });
    const capture = service({ backfillDays: 60, windowDays: 30 });
    await capture.captureWorkspace(backfillWorkspaceId, () => true);
    const afterFailure = await prisma.contactCaptureState.findFirstOrThrow({
      where: { integration: { sokoBotId: bot.id } },
    });
    const cursor = afterFailure.cursor as Record<
      string,
      { backfillUntil: string | null; pageToken: string | null }
    >;
    // Window one is done; window two failed on its first page and waits.
    expect(cursor["mail.sent"]).toMatchObject({ pageToken: null });
    expect(cursor["mail.sent"]?.backfillUntil).not.toBeNull();
    expect(afterFailure.lastError).toMatch(/Composio timeout/);
    expect(afterFailure.backfillCompletedAt).toBeNull();
    expect(
      await prisma.contactInteraction.count({
        where: { workspaceId: backfillWorkspaceId },
      }),
    ).toBe(2);

    failOnCall = 0;
    await capture.captureWorkspace(backfillWorkspaceId, () => true);
    await capture.captureWorkspace(backfillWorkspaceId, () => true);
    const done = await prisma.contactCaptureState.findFirstOrThrow({
      where: { integration: { sokoBotId: bot.id } },
    });
    expect(done.backfillCompletedAt).not.toBeNull();
    expect(done.lastError).toBeNull();
    const refs = (
      await prisma.contactInteraction.findMany({
        where: { workspaceId: backfillWorkspaceId },
      })
    ).map((interaction) => interaction.sourceRef);
    // Two windows of two pages, each once, the failed page included.
    expect(refs).toHaveLength(4);
    expect(new Set(refs).size).toBe(4);
    // Nothing older than the floor was asked for.
    expect(sentCalls.at(-1)).toMatch(/^2026-09-21:p2$/);
  });

  it("merges two contacts a Slack profile shows are one person", async () => {
    const actor: ContactActor = {
      workspaceId: mergeWorkspaceId,
      userId: bob,
      sokoBotId: null,
    };
    const byEmail = await inContactTransaction((tx) =>
      upsertContact(tx, actor, {
        name: "Nina Keller",
        channels: [{ type: "EMAIL", value: "nina.keller@acme-robotics.com" }],
        upsert: false,
      }),
    );
    const bySlack = await inContactTransaction((tx) =>
      upsertContact(tx, actor, {
        name: "N. Keller",
        channels: [{ type: "SLACK", value: "T0ACME:U0NINA" }],
        upsert: false,
      }),
    );
    const bot = await prisma.sokoBot.create({
      data: { userId: bob, workspaceId: mergeWorkspaceId },
    });
    await prisma.sokoBotIntegration.create({
      data: {
        sokoBotId: bot.id,
        provider: "slack",
        composioAccountId: `ca_${randomUUID()}`,
        status: "ACTIVE",
      },
    });
    // Bob is the owner here; Patrick's address is just another person.
    await service().captureWorkspace(mergeWorkspaceId, () => true);
    const live = await contactsOf(mergeWorkspaceId);
    const nina = live.find((contact) => contact.id === byEmail.contact.id);
    expect(nina?.channels.map((channel) => channel.value).sort()).toEqual([
      "T0ACME:U0NINA",
      "nina.keller@acme-robotics.com",
    ]);
    const loser = await prisma.contact.findUniqueOrThrow({
      where: { id: bySlack.contact.id },
    });
    expect(loser.mergedIntoId).toBe(byEmail.contact.id);
  });

  it("merges certain duplicates, suggests the rest, and enriches without overwriting", async () => {
    const actor: ContactActor = {
      workspaceId: mergeWorkspaceId,
      userId: bob,
      sokoBotId: null,
    };
    const create = (
      name: string,
      channels: { type: "EMAIL" | "PHONE"; value: string }[],
      organization?: string,
    ) =>
      inContactTransaction((tx) =>
        upsertContact(tx, actor, {
          name,
          organization,
          channels,
          upsert: false,
        }),
      );
    const tom = await create(
      "Tom Berger",
      [
        { type: "EMAIL", value: "tom@acme.test" },
        { type: "PHONE", value: "+41 79 111 22 33" },
      ],
      "Acme",
    );
    const twin = await create("Tom Berger", [
      { type: "EMAIL", value: "t.berger@acme.test" },
      { type: "PHONE", value: "079 111 22 33" },
    ]);
    const thomas = await create("Thomas Berger", [
      { type: "EMAIL", value: "thomas@acme.test" },
    ]);
    await inContactTransaction((tx) =>
      createContactList(tx, actor, {
        name: "Pilots",
        color: "blue",
        description: "Running a pilot",
      }),
    );
    await prisma.contactInteraction.create({
      data: {
        workspaceId: mergeWorkspaceId,
        contactId: thomas.contact.id,
        userId: bob,
        occurredAt: new Date("2026-10-01T10:00:00Z"),
        channel: "EMAIL",
        direction: "OUT",
        summary: "Pilot scope",
        sourceRef: "gmail:test:thomas-1",
      },
    });
    mocks.generateText.mockResolvedValue({
      text: 'Here: {"organization": "Acme Test AG", "role": null, "summary": "Runs the Acme pilot with Bob.", "evidence": [1]}',
      providerMetadata: { gateway: { cost: "0.0002" } },
    });
    mocks.judgeListMemberships.mockImplementation(
      async (_contact: unknown, lists: { id: string; name: string }[]) =>
        new Map(
          lists.map((list) => [list.id, list.name === "Pilots" ? 0.9 : 0.3]),
        ),
    );
    const stats = emptyEnrichmentStats();
    await enrichWorkspaceContacts({
      workspaceId: mergeWorkspaceId,
      budget: { enrichments: 20, usd: 0.05 },
      stats,
      shouldContinue: () => true,
    });
    expect(stats.merged).toBe(1);
    expect(stats.mergeSuggestions).toBeGreaterThan(0);
    const merged = await prisma.contact.findUniqueOrThrow({
      where: { id: twin.contact.id },
    });
    expect(merged.mergedIntoId).toBe(tom.contact.id);

    const enriched = await prisma.contact.findUniqueOrThrow({
      where: { id: thomas.contact.id },
      include: {
        listMemberships: { include: { list: true } },
        activities: true,
      },
    });
    expect(enriched).toMatchObject({
      organization: "Acme Test AG",
      role: null,
      summary: "Runs the Acme pilot with Bob.",
    });
    expect(enriched.enrichedAt).not.toBeNull();
    expect(
      enriched.listMemberships.map((membership) => [
        membership.list.name,
        membership.addedAutomatically,
      ]),
    ).toEqual([["Pilots", true]]);
    const update = enriched.activities.find(
      (activity) => activity.kind === "UPDATED",
    );
    expect(update?.changes).toMatchObject({
      organization: {
        before: null,
        after: "Acme Test AG",
        source: "enrichment:google/gemini-3.8-flash",
        evidence: ["gmail:test:thomas-1"],
      },
    });
    // Tom kept the organization a person set; the model's guess did not win.
    const kept = await prisma.contact.findUniqueOrThrow({
      where: { id: tom.contact.id },
    });
    expect(kept.organization).toBe("Acme");
    expect(stats.costUsd).toBeGreaterThan(0);

    const groups = await findDuplicateContacts(actor, {
      contactId: thomas.contact.id,
    });
    expect(
      groups.map((group) => group.contacts.map((contact) => contact.id).sort()),
    ).toContainEqual([tom.contact.id, thomas.contact.id].sort());
  });

  it("classifies a contact once, and never asks again for a missing role", async () => {
    const actor: ContactActor = {
      workspaceId: mergeWorkspaceId,
      userId: bob,
      sokoBotId: null,
    };
    await inContactTransaction((tx) =>
      upsertContact(tx, actor, {
        name: "Imported Person",
        organization: "Imported AG",
        summary: "Met at the fair.",
        channels: [{ type: "EMAIL", value: "imported@imported.test" }],
        upsert: false,
      }),
    );
    mocks.generateText.mockReset();
    mocks.generateText.mockResolvedValue({ text: "{}", providerMetadata: {} });
    const run = () =>
      enrichWorkspaceContacts({
        workspaceId: mergeWorkspaceId,
        budget: { enrichments: 20, usd: 0.05 },
        stats: emptyEnrichmentStats(),
        shouldContinue: () => true,
      });
    await run();
    await run();
    const prompts = mocks.generateText.mock.calls.map(
      ([request]) => (request as { prompt: string }).prompt,
    );
    expect(
      prompts.filter((prompt) => prompt.includes("Imported Person")),
    ).toHaveLength(1);
  });

  it("classifies captured entries, files them on lists and proposes at most one new list a day", async () => {
    // Captured by a Soko Bot, so the classifier may rename and reclassify.
    const actor: ContactActor = {
      workspaceId: classifyWorkspaceId,
      userId: bob,
      sokoBotId: randomUUID(),
    };
    const people = [
      ["Praxis", "info@praxis-weber.test", "Terminanfrage"],
      ["Omar Haddad", "omar@seedfund.test", "Monthly investor update"],
      ["Ines Fund", "ines@angelfund.test", "Seed round intro"],
      ["Paul Capital", "paul@capitalpartners.test", "Term sheet"],
      ["Vera Seed", "vera@seedvc.test", "Pitch deck"],
      ["Kai Other", "kai@other.test", "Lunch"],
      ["Lea Other", "lea@other2.test", "Coffee"],
    ] as const;
    const ids = new Map<string, string>();
    for (const [name, email, topic] of people) {
      const { contact } = await inContactTransaction((tx) =>
        upsertContact(tx, actor, {
          name,
          channels: [{ type: "EMAIL", value: email }],
          upsert: false,
        }),
      );
      ids.set(name, contact.id);
      await prisma.contactInteraction.create({
        data: {
          workspaceId: classifyWorkspaceId,
          contactId: contact.id,
          userId: bob,
          occurredAt: new Date("2026-10-01T10:00:00Z"),
          channel: "EMAIL",
          direction: "OUT",
          summary: topic,
          sourceRef: `gmail:classify:${email}`,
        },
      });
    }
    const human: ContactActor = { ...actor, sokoBotId: null };
    const zurich = await inContactTransaction((tx) =>
      createContactList(tx, human, {
        name: "Zurich",
        color: "blue",
        description: "People in Zurich",
      }),
    );
    const smart = await inContactTransaction((tx) =>
      createContactList(tx, human, {
        name: "Stale",
        color: "gray",
        smartFilter: { lastContactOlderThanDays: 90 },
      }),
    );
    mocks.generateText.mockImplementation(
      async (request: { system: string; prompt: string }) => {
        if (request.system.includes("contact lists tidy"))
          return {
            text: JSON.stringify({
              lists: [
                {
                  name: "Investors",
                  description: "Funds and angels we talk to about raising.",
                  members: request.prompt
                    .split("\n")
                    .flatMap((line) =>
                      /(Omar|Ines|Paul|Vera)/.test(line)
                        ? [Number(/^\[(\d+)\]/.exec(line)?.[1])]
                        : [],
                    ),
                },
                {
                  name: "Angel investors",
                  description: "Too close to the first one.",
                  members: [1, 2, 3],
                },
              ],
            }),
            providerMetadata: {},
          };
        return {
          text: request.prompt.includes("Name: Praxis")
            ? '{"kind":"organization","name":"Praxis Weber","organization":"Praxis Weber","relationship":null,"evidence":[1]}'
            : '{"kind":"person","name":null,"relationship":"investor","evidence":[1]}',
          providerMetadata: {},
        };
      },
    );
    // Jev is sure about nothing except, wrongly, the smart list.
    mocks.judgeListMemberships.mockImplementation(
      async (_contact: unknown, lists: { id: string }[]) =>
        new Map(lists.map((list) => [list.id, list.id === smart.id ? 1 : 0.5])),
    );
    const stats = emptyEnrichmentStats();
    await enrichWorkspaceContacts({
      workspaceId: classifyWorkspaceId,
      budget: { enrichments: 20, usd: 0.05 },
      stats,
      shouldContinue: () => true,
    });
    // The smart list is never asked about or filled.
    for (const [, lists] of mocks.judgeListMemberships.mock.calls)
      expect((lists as { id: string }[]).map((list) => list.id)).not.toContain(
        smart.id,
      );
    const praxis = await prisma.contact.findUniqueOrThrow({
      where: { id: ids.get("Praxis") },
      include: { activities: true },
    });
    expect(praxis).toMatchObject({
      name: "Praxis Weber",
      kind: "ORGANIZATION",
      stage: "CONTACT",
    });
    expect(praxis.classifiedAt).not.toBeNull();
    expect(
      praxis.activities.find(
        (activity) => "kind" in (activity.changes as object),
      )?.changes,
    ).toMatchObject({
      name: { before: "Praxis", after: "Praxis Weber" },
      kind: { before: "PERSON", after: "ORGANIZATION" },
    });
    expect(
      (
        await prisma.contact.findUniqueOrThrow({
          where: { id: ids.get("Omar Haddad") },
        })
      ).stage,
    ).toBe("INVESTOR");

    const created = await prisma.contactList.findMany({
      where: { workspaceId: classifyWorkspaceId, createdAutomatically: true },
      include: { members: true },
    });
    expect(created.map((list) => list.name)).toEqual(["Investors"]);
    expect(created[0]?.members).toHaveLength(4);
    expect(
      created[0]?.members.every((member) => member.addedAutomatically),
    ).toBe(true);
    expect(stats).toMatchObject({ listsCreated: 1, listProposalsRejected: 1 });
    expect(
      await prisma.contactListMember.count({
        where: { listId: { in: [zurich.id, smart.id] } },
      }),
    ).toBe(0);

    // A second batch the same day proposes nothing more.
    await prisma.contact.updateMany({
      where: { workspaceId: classifyWorkspaceId },
      data: { classifiedAt: null },
    });
    mocks.generateText.mockClear();
    await enrichWorkspaceContacts({
      workspaceId: classifyWorkspaceId,
      budget: { enrichments: 20, usd: 0.05 },
      stats: emptyEnrichmentStats(),
      shouldContinue: () => true,
    });
    expect(
      mocks.generateText.mock.calls.some(([request]) =>
        (request as { system: string }).system.includes("contact lists tidy"),
      ),
    ).toBe(false);
  });

  it("leaves contacts queued when the model fails or the money is spent", async () => {
    const actor: ContactActor = {
      workspaceId: mergeWorkspaceId,
      userId: bob,
      sokoBotId: null,
    };
    const queued = await inContactTransaction((tx) =>
      upsertContact(tx, actor, {
        name: "Queued Person",
        channels: [{ type: "EMAIL", value: "queued@company.test" }],
        upsert: false,
      }),
    );
    mocks.generateText.mockRejectedValue(new Error("gateway down"));
    const stats = emptyEnrichmentStats();
    await enrichWorkspaceContacts({
      workspaceId: mergeWorkspaceId,
      budget: { enrichments: 20, usd: 0.05 },
      stats,
      shouldContinue: () => true,
    });
    expect(stats.modelFailures).toBe(1);
    expect(
      (
        await prisma.contact.findUniqueOrThrow({
          where: { id: queued.contact.id },
        })
      ).enrichedAt,
    ).toBeNull();
    // An answer cut off by the output limit is a failure, not "nothing found".
    mocks.generateText.mockResolvedValue({
      text: '```json\n{\n  "organization": "Card',
      providerMetadata: {},
    });
    const cutOff = emptyEnrichmentStats();
    await enrichWorkspaceContacts({
      workspaceId: mergeWorkspaceId,
      budget: { enrichments: 20, usd: 0.05 },
      stats: cutOff,
      shouldContinue: () => true,
    });
    expect(cutOff.modelFailures).toBe(1);
    expect(
      (
        await prisma.contact.findUniqueOrThrow({
          where: { id: queued.contact.id },
        })
      ).enrichedAt,
    ).toBeNull();
    mocks.generateText.mockReset();
    await enrichWorkspaceContacts({
      workspaceId: mergeWorkspaceId,
      budget: { enrichments: 20, usd: 0 },
      stats: emptyEnrichmentStats(),
      shouldContinue: () => true,
    });
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(
      (
        await prisma.contact.findUniqueOrThrow({
          where: { id: queued.contact.id },
        })
      ).enrichedAt,
    ).toBeNull();
  });

  describe("guards", () => {
    beforeAll(async () => {
      await prisma.organization.create({
        data: {
          id: guardOrganizationId,
          name: "Capture guards",
          slug: `capture-guards-${guardOrganizationId}`,
        },
      });
      await prisma.member.create({
        data: { userId: alice, organizationId: guardOrganizationId },
      });
      await prisma.workspace.create({
        data: { id: guardWorkspaceId, organizationId: guardOrganizationId },
      });
    });

    it("pauses Slack for a day when the toolkit cannot say who is connected, and keeps reading mail", async () => {
      const bot = await addBot(guardWorkspaceId, ["slack", "gmail"]);
      mocks.runIntegrationTool.mockRejectedValue(
        new Error("Tool SLACK_TEST_AUTH not found"),
      );
      const run = await service().captureWorkspace(
        guardWorkspaceId,
        () => true,
      );
      expect(run.capture.unsupported).toEqual(["slack:slack"]);
      const slackState = await prisma.contactCaptureState.findFirstOrThrow({
        where: { integration: { sokoBotId: bot.id, provider: "slack" } },
      });
      const paused = (
        slackState.cursor as Record<string, { pausedUntil?: string }>
      ).slack?.pausedUntil;
      expect(new Date(paused ?? 0).getTime()).toBe(NOW.getTime() + 86_400_000);
      // Gmail went on: Nina was captured from the sent mail.
      expect(run.capture.interactions).toBeGreaterThan(0);
      mocks.runIntegrationTool.mockClear();
      await service().captureWorkspace(guardWorkspaceId, () => true);
      expect(mocks.runIntegrationTool).not.toHaveBeenCalled();
    });

    it("re-reads a page the write budget cut short, without writing anything twice", async () => {
      const bot = await prisma.sokoBot.findFirstOrThrow({
        where: { workspaceId: guardWorkspaceId },
      });
      await prisma.contact.deleteMany({
        where: { workspaceId: guardWorkspaceId },
      });
      await prisma.contactCaptureState.deleteMany({
        where: { integration: { sokoBotId: bot.id } },
      });
      const tight = service({ capturesPerWorkspace: 1 });
      const first = await tight.captureWorkspace(guardWorkspaceId, () => true);
      expect(first.capture.interactions).toBe(1);
      const state = await prisma.contactCaptureState.findFirstOrThrow({
        where: { integration: { sokoBotId: bot.id, provider: "gmail" } },
      });
      // The sent window was not finished, so its position did not move.
      expect(
        (state.cursor as Record<string, { since: string }>)["mail.sent"]?.since,
      ).toBe(NOW.toISOString());
      expect(state.backfillCompletedAt).toBeNull();
      // One write per run: keep running until every backfill is done.
      for (let run = 0; run < 20; run += 1) {
        await tight.captureWorkspace(guardWorkspaceId, () => true);
        const open = await prisma.contactCaptureState.count({
          where: {
            integration: { sokoBotId: bot.id },
            backfillCompletedAt: null,
          },
        });
        if (open === 0) break;
      }
      const refs = (
        await prisma.contactInteraction.findMany({
          where: { workspaceId: guardWorkspaceId },
        })
      ).map((interaction) => interaction.sourceRef?.split(":").at(-1));
      // Everything the fixtures hold, once. Bob's address is at the owner's
      // company domain, so his mail counts as team (only his Slack id is
      // captured); Nina wrote back to mail the owner sent her, so her answer
      // counts too.
      expect(refs.sort()).toEqual(
        [
          "U0BOB",
          "U0LUKAS",
          "U0NINA",
          "max@gmail.com",
          "nina.keller@acme-robotics.com",
          "nina.keller@acme-robotics.com",
          "tom.berger@acme-robotics.com",
        ].sort(),
      );
    });

    it("leaves role inboxes out when the judge budget is spent", async () => {
      const bot = await prisma.sokoBot.findFirstOrThrow({
        where: { workspaceId: guardWorkspaceId },
      });
      await prisma.contact.deleteMany({
        where: { workspaceId: guardWorkspaceId },
      });
      await prisma.contactCaptureState.deleteMany({
        where: { integration: { sokoBotId: bot.id } },
      });
      mocks.judgeRoleInboxes.mockImplementation(async (samples: unknown[]) =>
        samples.map(() => 0.95),
      );
      const run = await service({ judgeCallsPerWorkspace: 0 }).captureWorkspace(
        guardWorkspaceId,
        () => true,
      );
      expect(mocks.judgeRoleInboxes).not.toHaveBeenCalled();
      expect(run.capture.skipped.borderline_unjudged).toBeGreaterThan(0);
      expect(
        await prisma.contactChannel.count({
          where: {
            workspaceId: guardWorkspaceId,
            value: "support@vendor-saas.io",
          },
        }),
      ).toBe(0);
      const withJudge = await service().captureWorkspace(
        guardWorkspaceId,
        () => true,
      );
      expect(withJudge.capture.skipped.duplicate).toBeGreaterThan(0);
    });

    it("schedules a fresh backfill for a new account and keeps progress on a reconnect", async () => {
      const bot = await prisma.sokoBot.findFirstOrThrow({
        where: { workspaceId: guardWorkspaceId },
      });
      const gmail = await prisma.sokoBotIntegration.findFirstOrThrow({
        where: { sokoBotId: bot.id, provider: "gmail" },
      });
      await prisma.contactCaptureState.updateMany({
        where: { integrationId: gmail.id },
        data: { backfillCompletedAt: NOW },
      });
      await scheduleContactCapture({
        integrationId: gmail.id,
        provider: "gmail",
        reset: false,
      });
      expect(
        (
          await prisma.contactCaptureState.findUniqueOrThrow({
            where: { integrationId: gmail.id },
          })
        ).backfillCompletedAt,
      ).toEqual(NOW);
      await scheduleContactCapture({
        integrationId: gmail.id,
        provider: "gmail",
        reset: true,
      });
      const fresh = await prisma.contactCaptureState.findUniqueOrThrow({
        where: { integrationId: gmail.id },
      });
      expect(fresh.backfillCompletedAt).toBeNull();
      expect(fresh.cursor).toEqual({});
      const notion = await prisma.sokoBotIntegration.create({
        data: {
          sokoBotId: bot.id,
          provider: "notion",
          composioAccountId: `ca_${randomUUID()}`,
          status: "ACTIVE",
        },
      });
      await scheduleContactCapture({
        integrationId: notion.id,
        provider: "notion",
        reset: true,
      });
      expect(
        await prisma.contactCaptureState.count({
          where: { integrationId: notion.id },
        }),
      ).toBe(0);
    });
  });
});
