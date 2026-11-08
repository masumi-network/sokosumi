/**
 * Contact search against a real database: the triggers that keep each
 * search document current, ranked search by words, typos and meaning, the
 * background embedding, and breakdowns. Meaning uses a fake embedder whose
 * vectors stand for a few concepts.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EmbedTexts } from "@/lib/contacts/embeddings";
import prisma from "@/lib/db/prisma";
import { runContactTool } from "@/lib/soko-bot/contact-tools";
import { breakDownContacts } from "./contact-breakdown.service";
import { createContactList } from "./contact-lists.service";
import { embedStaleContacts, rankContacts } from "./contact-search.service";
import {
  type ContactActor,
  inContactTransaction,
  listContacts,
  logContactInteraction,
  updateContact,
  upsertContact,
} from "./contacts.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const alice = randomUUID();
const organizationId = randomUUID();
const workspaceId = randomUUID();
const actor: ContactActor = { workspaceId, userId: alice, sokoBotId: null };

const CONCEPTS: [RegExp, number][] = [
  [/invest|venture|fund|money/, 0],
  [/event|conference|summit/, 1],
  [/cit(y|ies)|urban/, 2],
];

/** One dimension per concept a text mentions, plus a little of everything. */
const fakeEmbed: EmbedTexts = async (values) => ({
  costUsd: 0,
  embeddings: values.map((value) => {
    const vector = Array.from({ length: 768 }, () => 0);
    vector[767] = 0.1;
    for (const [pattern, dimension] of CONCEPTS)
      if (pattern.test(value)) vector[dimension] = 1;
    return vector;
  }),
});

function create(input: Partial<Parameters<typeof upsertContact>[2]>) {
  return inContactTransaction(
    async (tx) =>
      (
        await upsertContact(tx, actor, {
          channels: [],
          upsert: false,
          ...input,
        })
      ).contact,
  );
}

const ids: Record<string, string> = {};

describe.runIf(enabled)("contact search on PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: alice,
        name: "Alice",
        email: `search-${alice}@sokosumi.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Search",
        slug: `search-${organizationId}`,
      },
    });
    await prisma.workspace.create({
      data: { id: workspaceId, organizationId },
    });
    ids.nina = (
      await create({
        name: "Nina Keller",
        organization: "Acme",
        role: "Head of Partnerships",
        location: "Zürich, Switzerland",
        stage: "PARTNER",
        channels: [{ type: "EMAIL", value: "nina@acme.com" }],
      })
    ).id;
    ids.ryan = (
      await create({
        name: "Ryan Green",
        organization: "ACME ",
        location: "Berlin, Germany",
        stage: "INVESTOR",
        summary: "Pre-seed venture partner backing fintech founders.",
      })
    ).id;
    ids.marina = (
      await create({
        name: "Marina Starkova",
        organization: "House of Communication",
        location: "Munich",
        summary: "Runs the summit programme.",
      })
    ).id;
    ids.lena = (
      await create({
        name: "Lena Fox",
        location: "Berlin, Germany",
        stage: "COMMUNITY",
        summary: "Writes about cities.",
        channels: [{ type: "X", value: "lenafox", source: "X" }],
      })
    ).id;
    await prisma.contactChannel.updateMany({
      where: { contactId: ids.lena, type: "X" },
      data: { followers: 12_000 },
    });
    await inContactTransaction((tx) =>
      logContactInteraction(tx, actor, ids.nina as string, {
        occurredAt: new Date().toISOString(),
        channel: "EMAIL",
        summary: "Pilot",
      }),
    );
    const list = await inContactTransaction((tx) =>
      createContactList(tx, actor, { name: "Berlin", color: "blue" }),
    );
    await prisma.contactListMember.createMany({
      data: [ids.ryan, ids.lena].map((contactId) => ({
        listId: list.id,
        contactId: contactId as string,
      })),
    });
  });

  afterAll(async () => {
    await prisma.contactList.deleteMany({ where: { workspaceId } });
    await prisma.contact.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: alice } });
  });

  it("keeps each contact's document current, accents and addresses included", async () => {
    const row = await prisma.contactSearch.findUniqueOrThrow({
      where: { contactId: ids.nina },
    });
    expect(row.document).toContain("zurich, switzerland");
    expect(row.document).toContain("nina acme com");
    expect(row.embeddedHash).toBeNull();
  });

  it("ranks by words and parts of words, without meaning", async () => {
    const words = await rankContacts(workspaceId, "acme partnerships", {
      mode: "words",
    });
    expect(words[0]?.id).toBe(ids.nina);
    const typo = await rankContacts(workspaceId, "Starkowa", { mode: "words" });
    expect(typo.map((entry) => entry.id)).toEqual([ids.marina]);
    expect(await rankContacts(workspaceId, "zzzz", { mode: "words" })).toEqual(
      [],
    );
  });

  it("embeds stale documents, then finds people by meaning", async () => {
    expect(await embedStaleContacts(workspaceId, { embed: fakeEmbed })).toEqual(
      { embedded: 4, costUsd: 0 },
    );
    const money = await rankContacts(workspaceId, "money people", {
      embed: fakeEmbed,
    });
    expect(money.map((entry) => entry.id)).toEqual([ids.ryan]);
    // A changed document is embedded again, nothing else.
    const nina = await prisma.contact.findUniqueOrThrow({
      where: { id: ids.nina },
    });
    await inContactTransaction((tx) =>
      updateContact(tx, actor, nina.id, {
        version: nina.version,
        summary: "Speaks at every fintech conference.",
      }),
    );
    expect(await embedStaleContacts(workspaceId, { embed: fakeEmbed })).toEqual(
      { embedded: 1, costUsd: 0 },
    );
  });

  it("orders a filtered page by relevance and pages through it", async () => {
    const first = await listContacts(actor, {
      filter: { location: "berlin" },
      query: "Berlin",
      mode: "words",
      sort: "updatedAt",
      limit: 1,
    });
    expect(first.total).toBe(2);
    const second = await listContacts(actor, {
      filter: { location: "berlin" },
      query: "Berlin",
      mode: "words",
      sort: "updatedAt",
      limit: 1,
      cursor: first.nextCursor ?? undefined,
    });
    expect(
      [...first.items, ...second.items].map((contact) => contact.id).sort(),
    ).toEqual([ids.ryan, ids.lena].sort());
    expect(second.nextCursor).toBeNull();
  });

  it("refuses a cursor the ranking no longer holds", async () => {
    await expect(
      listContacts(actor, {
        filter: {},
        query: "Berlin",
        mode: "words",
        sort: "updatedAt",
        limit: 1,
        cursor: randomUUID(),
      }),
    ).rejects.toThrow(/run it again/);
  });

  it("finds archived contacts when asked for them", async () => {
    const gone = await create({ name: "Otto Archived", location: "Berlin" });
    await prisma.contact.update({
      where: { id: gone.id },
      data: { archivedAt: new Date() },
    });
    const live = await rankContacts(workspaceId, "otto", { mode: "words" });
    expect(live).toEqual([]);
    const archived = await listContacts(actor, {
      filter: {},
      query: "otto",
      mode: "words",
      archived: true,
      sort: "updatedAt",
      limit: 5,
    });
    expect(archived.items.map((contact) => contact.name)).toEqual([
      "Otto Archived",
    ]);
    await prisma.contact.delete({ where: { id: gone.id } });
  });

  it("keeps the document current when channels move in one statement", async () => {
    const extra = await create({
      name: "Extra Person",
      channels: [
        { type: "EMAIL", value: "a@moved.example" },
        { type: "EMAIL", value: "b@moved.example" },
      ],
    });
    await prisma.contactChannel.updateMany({
      where: { contactId: extra.id },
      data: { contactId: ids.marina },
    });
    const marina = await prisma.contactSearch.findUniqueOrThrow({
      where: { contactId: ids.marina },
    });
    expect(marina.document).toContain("a@moved.example");
    expect(marina.document).toContain("b@moved.example");
    const left = await prisma.contactSearch.findUniqueOrThrow({
      where: { contactId: extra.id },
    });
    expect(left.document).not.toContain("moved");
    await prisma.contactChannel.deleteMany({
      where: { contactId: ids.marina, value: { contains: "moved" } },
    });
    await prisma.contact.delete({ where: { id: extra.id } });
    expect(
      (
        await prisma.contactSearch.findUniqueOrThrow({
          where: { contactId: ids.marina },
        })
      ).document,
    ).not.toContain("moved");
  });

  it("counts and breaks down without reading every contact", async () => {
    expect(
      await breakDownContacts(actor, { filter: {}, by: "organization" }),
    ).toEqual({
      total: 4,
      groups: [
        { key: "acme", label: expect.stringMatching(/^acme$/i), count: 2 },
        {
          key: "house of communication",
          label: "House of Communication",
          count: 1,
        },
        { key: null, label: "(none)", count: 1 },
      ],
      otherGroups: 0,
    });
    const byList = await breakDownContacts(actor, {
      filter: { location: "germany" },
      by: "list",
    });
    expect(byList.groups).toEqual([
      { key: expect.any(String), label: "Berlin", count: 2 },
    ]);
    const known = await breakDownContacts(actor, { filter: {}, by: "knownBy" });
    expect(known.groups).toEqual([{ key: alice, label: "Alice", count: 1 }]);
    const recency = await breakDownContacts(actor, {
      filter: {},
      by: "lastContact",
    });
    expect(recency.groups).toEqual([
      { key: "30d", label: "In the last 30 days", count: 1 },
      { key: null, label: "Never", count: 3 },
    ]);
    expect(
      (await breakDownContacts(actor, { filter: { minFollowers: 10_000 } }))
        .total,
    ).toBe(1);
  });

  it("answers a bot's search compactly, with extra fields on request", async () => {
    const hooks = {
      authorize: async () => undefined,
      commit: async () => undefined,
    };
    const result = (await runContactTool(
      "search_contacts",
      { channelSource: "X", fields: ["summary"] },
      actor,
      hooks,
    )) as { contacts: Record<string, unknown>[]; total: number };
    expect(result.total).toBe(1);
    expect(result.contacts[0]).toEqual({
      id: ids.lena,
      name: "Lena Fox",
      kind: "PERSON",
      organization: null,
      role: null,
      location: "Berlin, Germany",
      stage: "COMMUNITY",
      replyState: null,
      lastContactAt: null,
      interactionCount: 0,
      version: 1,
      channels: [{ type: "X", value: "lenafox", followers: 12_000 }],
      lists: ["Berlin"],
      summary: "Writes about cities.",
    });
    expect(
      await runContactTool(
        "count_contacts",
        { stages: ["INVESTOR", "PARTNER"], by: "stage" },
        actor,
        hooks,
      ),
    ).toMatchObject({
      total: 2,
      groups: [
        { key: "INVESTOR", count: 1 },
        { key: "PARTNER", count: 1 },
      ],
    });
  });
});
