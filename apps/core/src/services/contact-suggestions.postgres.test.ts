/**
 * Find people against a real database: suggestions land on the list, the
 * run is charged per person found, people already on the list or suggested
 * before are skipped, and adding makes a Prospect contact on the list. Enrich
 * fills a contact's empty fields from the web. Exa and the model are scripted.
 */
import { randomUUID } from "node:crypto";
import { creditBucketRepository } from "@sokosumi/database/repositories";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import { createContactList } from "./contact-lists.service";
import {
  addContactSuggestions,
  dismissContactSuggestions,
  enrichContactFromWeb,
  findPeopleForList,
  listContactSuggestions,
  type PeopleSearchDeps,
} from "./contact-suggestions.service";
import {
  type ContactActor,
  inContactTransaction,
  upsertContact,
} from "./contacts.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const alice = randomUUID();
const organizationId = randomUUID();
const workspaceId = randomUUID();
const asAlice: ContactActor = { workspaceId, userId: alice, sokoBotId: null };
const CREDIT = 10n ** 10n;

const hits = [
  {
    title: "Mara Lind - Partner at Northwind Ventures | LinkedIn",
    url: "https://www.linkedin.com/in/maralind/",
    passages: ["Partner at Northwind Ventures, pre-seed AI infrastructure."],
  },
  {
    title: "Northwind Ventures",
    url: "https://northwind.vc",
    passages: ["A fund."],
  },
  {
    title: "Jonas Berg - Angel investor | LinkedIn",
    url: "https://linkedin.com/in/jonasberg",
    passages: ["Angel in agent tooling."],
  },
];

/**
 * Exa returns the hits; the model keeps every person it is shown, and
 * identifies the first LinkedIn profile as the contact.
 */
function scripted(found = hits): PeopleSearchDeps & { searched: string[] } {
  const searched: string[] = [];
  return {
    searched,
    async search({ query }) {
      searched.push(query);
      return { hits: found, costUsd: 0.012 };
    },
    async match({ hits: shown }) {
      return {
        costUsd: 0.001,
        matches: shown.flatMap((hit, index) =>
          hit.title.includes("LinkedIn")
            ? [
                {
                  index,
                  name: hit.title.split(" - ")[0] ?? hit.title,
                  role: "Partner",
                  organization: "Northwind Ventures",
                  location: null,
                  reason: "Leads pre-seed rounds in AI infrastructure.",
                },
              ]
            : [],
        ),
      };
    },
    async identify({ hits: shown }) {
      const index = shown.findIndex((hit) => hit.title.includes("LinkedIn"));
      return {
        costUsd: 0.001,
        identity:
          index < 0
            ? null
            : {
                index,
                role: "Partner",
                organization: "Northwind Ventures",
                location: "Berlin",
                summary: "Invests in pre-seed AI infrastructure.",
              },
      };
    },
  };
}

function balance(): Promise<bigint> {
  return creditBucketRepository.getBalance(alice, organizationId, prisma);
}

describe.runIf(enabled)("Find people on PostgreSQL", () => {
  let listId: string;

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: alice,
        name: "Alice",
        email: `find-${alice}@sokosumi.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Find test",
        slug: `find-${organizationId}`,
        members: { create: { userId: alice, role: "member" } },
      },
    });
    await prisma.workspace.create({
      data: { id: workspaceId, organizationId },
    });
    const topUp = await prisma.transaction.create({
      data: { amount: 20n * CREDIT, organizationId },
      select: { id: true },
    });
    await prisma.creditBucket.create({
      data: {
        amount: 20n * CREDIT,
        organizationId,
        sourceTransactionId: topUp.id,
      },
    });
    const list = await inContactTransaction((tx) =>
      createContactList(tx, asAlice, { name: "Investors", color: "blue" }),
    );
    listId = list.id;
  });

  afterAll(async () => {
    await prisma.contactList.deleteMany({ where: { workspaceId } });
    await prisma.contactPeopleSearch.deleteMany({ where: { workspaceId } });
    await prisma.contact.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.creditConsumption.deleteMany({
      where: { bucket: { organizationId } },
    });
    await prisma.creditBucket.deleteMany({ where: { organizationId } });
    await prisma.transaction.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: alice } });
  });

  it("asks for a description before searching", async () => {
    await expect(
      findPeopleForList(asAlice, listId, { size: 10 }, scripted()),
    ).rejects.toThrow("Describe who belongs in this list");
  });

  it("suggests the people who fit, saves the brief and charges per person", async () => {
    const deps = scripted();
    const result = await findPeopleForList(
      asAlice,
      listId,
      { brief: "Pre-seed investors in AI infrastructure", size: 10 },
      deps,
    );

    expect(deps.searched).toEqual(["Pre-seed investors in AI infrastructure"]);
    expect(result.credits).toBe(1);
    expect(result.suggestions.map((s) => s.name).sort()).toEqual([
      "Jonas Berg",
      "Mara Lind",
    ]);
    expect(await balance()).toBe(19n * CREDIT);
    const list = await prisma.contactList.findUniqueOrThrow({
      where: { id: listId },
    });
    expect(list.description).toBe("Pre-seed investors in AI infrastructure");
    const run = await prisma.contactPeopleSearch.findFirstOrThrow({
      where: { listId },
    });
    expect(run).toMatchObject({ found: 2, costUsdMicros: 13_000 });
    expect(run.transactionId).not.toBeNull();
  });

  it("never suggests the same person to the list twice, and a run that finds nobody is free", async () => {
    const result = await findPeopleForList(
      asAlice,
      listId,
      { size: 10 },
      scripted(),
    );
    expect(result).toMatchObject({ found: 0, credits: 0 });
    expect(await balance()).toBe(19n * CREDIT);
  });

  it("finds one particular person for half a credit, and keeps the list's description", async () => {
    const deps = scripted([
      {
        title: "Lea Kurz - GP at Fjord Capital | LinkedIn",
        url: "https://linkedin.com/in/leakurz",
        passages: ["General partner at Fjord Capital."],
      },
      {
        title: "Lea Kurz - Designer | LinkedIn",
        url: "https://linkedin.com/in/leakurz-design",
        passages: ["Product designer."],
      },
    ]);
    const result = await findPeopleForList(
      asAlice,
      listId,
      { brief: "Lea Kurz, GP at Fjord Capital", size: 1 },
      deps,
    );
    expect(result).toMatchObject({ found: 1, credits: 0.5 });
    expect(result.suggestions.map((s) => s.name)).toEqual(["Lea Kurz"]);
    expect(await balance()).toBe(185n * (CREDIT / 10n));
    const list = await prisma.contactList.findUniqueOrThrow({
      where: { id: listId },
    });
    expect(list.description).toBe("Pre-seed investors in AI infrastructure");
    await dismissContactSuggestions(
      asAlice,
      listId,
      result.suggestions.map((s) => s.id),
    );
  });

  it("enriches a contact's empty fields from the web for one credit, keeping what is there", async () => {
    const { contact } = await inContactTransaction((tx) =>
      upsertContact(tx, asAlice, {
        name: "Mara Lindqvist",
        role: "Managing Partner",
        channels: [{ type: "EMAIL", value: "mara@northwind.vc" }],
        upsert: false,
      }),
    );
    const deps = scripted([
      {
        title: "Mara Lindqvist - Managing Partner | LinkedIn",
        url: "https://www.linkedin.com/in/maralindqvist/",
        passages: ["Managing Partner at Northwind Ventures, Berlin."],
      },
    ]);
    const result = await enrichContactFromWeb(asAlice, contact.id, deps);

    expect(deps.searched).toEqual([
      "Mara Lindqvist, northwind.vc, Managing Partner",
    ]);
    expect(result).toEqual({
      filled: ["organization", "location", "summary", "linkedin"],
      sourceUrl: "https://www.linkedin.com/in/maralindqvist/",
      credits: 1,
    });
    const enriched = await prisma.contact.findUniqueOrThrow({
      where: { id: contact.id },
      include: { channels: true },
    });
    expect(enriched).toMatchObject({
      role: "Managing Partner",
      organization: "Northwind Ventures",
      location: "Berlin",
    });
    expect(enriched.channels.map((c) => c.type).sort()).toEqual([
      "EMAIL",
      "LINKEDIN",
    ]);
    const history = await prisma.contactActivity.findFirstOrThrow({
      where: { contactId: contact.id, kind: "UPDATED" },
    });
    expect(history.changes).toMatchObject({
      location: { sourceUrls: ["https://www.linkedin.com/in/maralindqvist/"] },
    });
    expect(await balance()).toBe(175n * (CREDIT / 10n));
  });

  it("charges nothing when the web has no match", async () => {
    const { contact } = await inContactTransaction((tx) =>
      upsertContact(tx, asAlice, {
        name: "Nobody Known",
        channels: [],
        upsert: false,
      }),
    );
    const result = await enrichContactFromWeb(
      asAlice,
      contact.id,
      scripted([hits[1] as (typeof hits)[number]]),
    );
    expect(result).toEqual({ filled: [], sourceUrl: null, credits: 0 });
    expect(await balance()).toBe(175n * (CREDIT / 10n));
  });

  it("adds a suggestion as a Prospect on the list, and dismisses another", async () => {
    const waiting = await listContactSuggestions(asAlice, listId);
    const mara = waiting.find((s) => s.name === "Mara Lind");
    const jonas = waiting.find((s) => s.name === "Jonas Berg");
    if (!mara || !jonas) throw new Error("missing suggestions");

    expect(await addContactSuggestions(asAlice, listId, [mara.id])).toEqual({
      added: 1,
    });
    expect(
      await dismissContactSuggestions(asAlice, listId, [jonas.id]),
    ).toEqual({ dismissed: 1 });

    const contact = await prisma.contact.findFirstOrThrow({
      where: { workspaceId, name: "Mara Lind" },
      include: { channels: true, listMemberships: true },
    });
    expect(contact).toMatchObject({
      stage: "PROSPECT",
      organization: "Northwind Ventures",
      whyInteresting: "Leads pre-seed rounds in AI infrastructure.",
    });
    expect(contact.channels).toMatchObject([
      { type: "LINKEDIN", source: "WEB_RESEARCH" },
    ]);
    expect(contact.listMemberships.map((m) => m.listId)).toEqual([listId]);
    expect(await listContactSuggestions(asAlice, listId)).toEqual([]);
  });

  it("refuses a run the balance cannot pay for, before searching", async () => {
    await prisma.creditConsumption.create({
      data: {
        bucketId: (
          await prisma.creditBucket.findFirstOrThrow({
            where: { organizationId },
          })
        ).id,
        amount: 12n * CREDIT,
        transactionId: (
          await prisma.transaction.create({
            data: { amount: -12n * CREDIT, organizationId },
            select: { id: true },
          })
        ).id,
      },
    });
    const deps = scripted();
    await expect(
      findPeopleForList(asAlice, listId, { size: 25 }, deps),
    ).rejects.toThrow("Not enough credits");
    expect(deps.searched).toEqual([]);
  });
});
