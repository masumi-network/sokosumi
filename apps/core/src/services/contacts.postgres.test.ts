/**
 * Contacts against a real database: the guarantees that live in Postgres
 * (one owner per channel, idempotent capture by sourceRef, derived fields in
 * the same transaction, merges that move everything) and the queries built on
 * them (smart lists, sorting with empty dates, import and export).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import {
  createContactList,
  deleteContactList,
  listContactLists,
  updateContactListMembers,
} from "./contact-lists.service";
import {
  addContactChannel,
  type ContactActor,
  captureContactInteraction,
  findDuplicateContacts,
  getContactDetail,
  inContactTransaction,
  listContactActivity,
  listContacts,
  logContactInteraction,
  mergeContacts,
  removeContactChannel,
  removeContactInteraction,
  setContactArchived,
  updateContact,
  upsertContact,
} from "./contacts.service";
import {
  exportContactsCsv,
  importContactsFromTable,
} from "./contacts-import.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const alice = randomUUID();
const bob = randomUUID();
const outsider = randomUUID();
const organizationId = randomUUID();
const workspaceId = randomUUID();
const otherWorkspaceId = randomUUID();
const asAlice: ContactActor = { workspaceId, userId: alice, sokoBotId: null };
const asBob: ContactActor = { workspaceId, userId: bob, sokoBotId: null };
const asOutsider: ContactActor = {
  workspaceId: otherWorkspaceId,
  userId: outsider,
  sokoBotId: null,
};

function create(
  actor: ContactActor,
  input: Partial<Parameters<typeof upsertContact>[2]>,
) {
  return inContactTransaction((tx) =>
    upsertContact(tx, actor, { channels: [], upsert: false, ...input }),
  );
}

function log(
  actor: ContactActor,
  contactId: string,
  occurredAt: string,
  sourceRef?: string,
) {
  return inContactTransaction((tx) =>
    logContactInteraction(tx, actor, contactId, {
      occurredAt,
      channel: "EMAIL",
      summary: "Talked about the pilot",
      sourceRef,
    }),
  );
}

describe.runIf(enabled)("contacts on PostgreSQL", () => {
  beforeAll(async () => {
    for (const id of [alice, bob, outsider])
      await prisma.user.create({
        data: {
          id,
          name: id === alice ? "Alice" : id === bob ? "Bob" : "Olga",
          email: `contacts-${id}@sokosumi.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Contacts test",
        slug: `contacts-${organizationId}`,
      },
    });
    await prisma.member.createMany({
      data: [alice, bob].map((userId) => ({ userId, organizationId })),
    });
    await prisma.workspace.create({
      data: { id: workspaceId, organizationId },
    });
    await prisma.workspace.create({
      data: { id: otherWorkspaceId, userId: outsider },
    });
  });

  afterAll(async () => {
    await prisma.dataTable.deleteMany({
      where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } },
    });
    await prisma.contactList.deleteMany({
      where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } },
    });
    await prisma.contact.deleteMany({
      where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } },
    });
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspaceId, otherWorkspaceId] } },
    });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({
      where: { id: { in: [alice, bob, outsider] } },
    });
  });

  it("gives a channel to one contact per workspace, and normalizes it first", async () => {
    const first = await create(asAlice, {
      name: "Nina Keller",
      channels: [{ type: "EMAIL", value: " Nina@Example.COM " }],
    });
    expect(first.created).toBe(true);
    expect(first.contact.channels).toMatchObject([
      { type: "EMAIL", value: "nina@example.com", isPrimary: true },
    ]);

    await expect(
      create(asBob, {
        name: "Nina K.",
        channels: [{ type: "EMAIL", value: "mailto:nina@example.com" }],
      }),
    ).rejects.toMatchObject({
      status: 409,
      cause: {
        kind: "contact_channel_taken",
        extensions: { existingContactId: first.contact.id },
      },
    });
    const second = await create(asAlice, { name: "Somebody else" });
    await expect(
      inContactTransaction((tx) =>
        addContactChannel(tx, asAlice, second.contact.id, {
          type: "EMAIL",
          value: "NINA@example.com",
        }),
      ),
    ).rejects.toMatchObject({ status: 409 });

    // Another workspace has its own set: the same address is free there.
    const elsewhere = await create(asOutsider, {
      channels: [{ type: "EMAIL", value: "nina@example.com" }],
    });
    expect(elsewhere.contact.name).toBe("Nina");
    await expect(
      getContactDetail(asOutsider, first.contact.id),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("attaches new channels on upsert and fills only empty fields", async () => {
    const original = await create(asAlice, {
      name: "Tom Berger",
      organization: "Acme",
      channels: [{ type: "EMAIL", value: "tom@acme.test" }],
    });
    const upserted = await create(asBob, {
      name: "Thomas",
      organization: "Other Corp",
      role: "CTO",
      upsert: true,
      channels: [
        { type: "EMAIL", value: "TOM@acme.test" },
        { type: "LINKEDIN", value: "https://www.linkedin.com/in/TomBerger/" },
        { type: "PHONE", value: "+41 79 123 45 67" },
      ],
    });
    expect(upserted).toMatchObject({
      created: false,
      changed: true,
      mergeSuggestion: null,
    });
    expect(upserted.contact).toMatchObject({
      id: original.contact.id,
      name: "Tom Berger",
      organization: "Acme",
      role: "CTO",
      version: original.contact.version + 1,
    });
    expect(
      upserted.contact.channels.map(({ type, value }) => `${type}:${value}`),
    ).toEqual([
      "EMAIL:tom@acme.test",
      "LINKEDIN:https://www.linkedin.com/in/tomberger",
      "PHONE:+41791234567",
    ]);

    const again = await create(asBob, {
      upsert: true,
      channels: [{ type: "PHONE", value: "0041 79 123 45 67" }],
    });
    expect(again).toMatchObject({ created: false, changed: false });
    expect(again.contact.version).toBe(upserted.contact.version);
  });

  it("suggests a merge when an upsert's channels belong to two people", async () => {
    const work = await create(asAlice, {
      name: "Lea Novak",
      channels: [{ type: "EMAIL", value: "lea@work.test" }],
    });
    const home = await create(asAlice, {
      name: "Lea N.",
      channels: [{ type: "EMAIL", value: "lea@home.test" }],
    });
    const result = await create(asAlice, {
      upsert: true,
      channels: [
        { type: "EMAIL", value: "lea@work.test" },
        { type: "EMAIL", value: "lea@home.test" },
      ],
    });
    expect(result.contact.id).toBe(work.contact.id);
    expect(result.mergeSuggestion).toEqual({
      reason: "shared_channel",
      contactIds: [work.contact.id, home.contact.id],
    });
  });

  it("keeps first contact, last contact and the count in step, once per sourceRef", async () => {
    const { contact } = await create(asAlice, { name: "Derived Fields" });
    const one = await log(asAlice, contact.id, "2026-03-01T10:00:00Z", "msg-1");
    const replay = await log(
      asBob,
      contact.id,
      "2026-03-09T10:00:00Z",
      "msg-1",
    );
    expect(replay).toMatchObject({
      created: false,
      interaction: { id: one.interaction.id },
    });
    await log(asBob, contact.id, "2026-05-01T10:00:00Z", "msg-2");
    const middle = await log(asAlice, contact.id, "2026-04-01T10:00:00Z");

    let detail = await getContactDetail(asAlice, contact.id);
    expect(detail).toMatchObject({
      firstContactAt: new Date("2026-03-01T10:00:00.000Z"),
      lastContactAt: new Date("2026-05-01T10:00:00.000Z"),
      interactionCount: 3,
    });
    expect(detail.knownBy.map((person) => person.name)).toEqual([
      "Bob",
      "Alice",
    ]);
    expect(detail.knownBy[1]).toMatchObject({ interactionCount: 2 });
    expect(detail.recentInteractions.map((entry) => entry.occurredAt)).toEqual([
      new Date("2026-05-01T10:00:00Z"),
      new Date("2026-04-01T10:00:00Z"),
      new Date("2026-03-01T10:00:00Z"),
    ]);

    await inContactTransaction((tx) =>
      removeContactInteraction(tx, asAlice, contact.id, one.interaction.id),
    );
    detail = await getContactDetail(asAlice, contact.id);
    expect(detail).toMatchObject({
      firstContactAt: new Date("2026-04-01T10:00:00.000Z"),
      interactionCount: 2,
    });
    expect(middle.created).toBe(true);
  });

  it("refuses a stale version and records who changed what", async () => {
    const { contact } = await create(
      { ...asAlice, sokoBotId: randomUUID() },
      { name: "Version Test" },
    );
    const updated = await inContactTransaction((tx) =>
      updateContact(tx, asAlice, contact.id, {
        version: contact.version,
        stage: "PARTNER",
        followUpAt: "2026-11-02",
      }),
    );
    expect(updated).toMatchObject({
      stage: "PARTNER",
      followUpAt: "2026-11-02",
      version: contact.version + 1,
    });
    await expect(
      inContactTransaction((tx) =>
        updateContact(tx, asBob, contact.id, {
          version: contact.version,
          stage: "DORMANT",
        }),
      ),
    ).rejects.toMatchObject({
      status: 409,
      cause: { kind: "contact_version_conflict" },
    });

    const activity = await listContactActivity(asAlice, contact.id, {
      limit: 10,
    });
    expect(activity.items.map((entry) => entry.kind)).toEqual([
      "UPDATED",
      "CREATED",
    ]);
    expect(activity.items[0]?.changes).toMatchObject({
      stage: { before: "CONTACT", after: "PARTNER" },
    });
    expect(activity.items[1]?.sokoBot).toBeNull();
    expect(activity.items[1]?.user).toMatchObject({ name: "Alice" });
  });

  it("merges channels, interactions, lists and history into the winner", async () => {
    const list = await inContactTransaction((tx) =>
      createContactList(tx, asAlice, { name: "Investors", color: "violet" }),
    );
    const winner = await create(asAlice, {
      name: "Maya Stone",
      channels: [{ type: "EMAIL", value: "maya@one.test" }],
    });
    const loser = await create(asBob, {
      name: "Maya S.",
      organization: "Stone Ventures",
      location: "Zurich",
      customFields: { fund: "II" },
      channels: [
        { type: "EMAIL", value: "maya@two.test" },
        { type: "X", value: "@MayaStone" },
      ],
    });
    const second = await create(asBob, {
      name: "M. Stone",
      organization: "Ignored Org",
      role: "Partner",
    });
    await log(asBob, loser.contact.id, "2025-01-05T09:00:00Z");
    await log(asAlice, winner.contact.id, "2026-02-05T09:00:00Z");
    await inContactTransaction((tx) =>
      updateContactListMembers(tx, asAlice, list.id, {
        add: [winner.contact.id, loser.contact.id, second.contact.id],
        remove: [],
      }),
    );

    const merged = await inContactTransaction((tx) =>
      mergeContacts(tx, asAlice, winner.contact.id, [
        loser.contact.id,
        second.contact.id,
      ]),
    );
    expect(merged).toMatchObject({
      name: "Maya Stone",
      organization: "Stone Ventures",
      location: "Zurich",
      role: "Partner",
      customFields: { fund: "II" },
      interactionCount: 2,
      firstContactAt: new Date("2025-01-05T09:00:00Z"),
      lists: [{ id: list.id }],
    });
    expect(
      merged.channels.map(({ type, value, isPrimary }) => ({
        type,
        value,
        isPrimary,
      })),
    ).toEqual([
      { type: "EMAIL", value: "maya@one.test", isPrimary: true },
      { type: "X", value: "mayastone", isPrimary: true },
      { type: "EMAIL", value: "maya@two.test", isPrimary: false },
    ]);
    const tombstone = await getContactDetail(asAlice, loser.contact.id);
    expect(tombstone).toMatchObject({
      mergedIntoId: winner.contact.id,
      channels: [],
      interactionCount: 1,
    });
    expect(tombstone.archivedAt).not.toBeNull();
    await expect(
      inContactTransaction((tx) =>
        mergeContacts(tx, asAlice, winner.contact.id, [loser.contact.id]),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      inContactTransaction((tx) =>
        updateContact(tx, asAlice, loser.contact.id, {
          version: tombstone.version,
          name: "x",
        }),
      ),
    ).rejects.toMatchObject({ status: 409 });

    // The address that belonged to the loser now resolves to the winner.
    const found = await create(asAlice, {
      upsert: true,
      channels: [{ type: "EMAIL", value: "maya@two.test" }],
    });
    expect(found.contact.id).toBe(winner.contact.id);
    const [investors] = (await listContactLists(asAlice)).filter(
      (entry) => entry.id === list.id,
    );
    expect(investors?.count).toBe(1);
    const history = await listContactActivity(asAlice, winner.contact.id, {
      limit: 20,
    });
    expect(history.items[0]?.kind).toBe("MERGED");
    expect(history.items.some((entry) => entry.user?.name === "Bob")).toBe(
      true,
    );
  });

  it("adds and removes list members, counts live contacts, and refuses smart-list edits", async () => {
    const list = await inContactTransaction((tx) =>
      createContactList(tx, asAlice, { name: "Press", color: "blue" }),
    );
    await expect(
      inContactTransaction((tx) =>
        createContactList(tx, asBob, { name: "press", color: "red" }),
      ),
    ).rejects.toMatchObject({ status: 409 });
    const a = await create(asAlice, { name: "Press One" });
    const b = await create(asAlice, { name: "Press Two" });
    let updated = await inContactTransaction((tx) =>
      updateContactListMembers(tx, asAlice, list.id, {
        add: [a.contact.id, b.contact.id, a.contact.id],
        remove: [],
      }),
    );
    expect(updated.count).toBe(2);
    updated = await inContactTransaction((tx) =>
      updateContactListMembers(tx, asBob, list.id, {
        add: [a.contact.id],
        remove: [b.contact.id],
      }),
    );
    expect(updated.count).toBe(1);
    await inContactTransaction((tx) =>
      setContactArchived(tx, asAlice, a.contact.id, true),
    );
    expect(
      (await listContactLists(asAlice)).find((entry) => entry.id === list.id)
        ?.count,
    ).toBe(0);
    await inContactTransaction((tx) =>
      setContactArchived(tx, asAlice, a.contact.id, false),
    );

    const smart = await inContactTransaction((tx) =>
      createContactList(tx, asAlice, {
        name: "Press I know",
        color: "green",
        smartFilter: { listIds: [list.id], knownByMe: true },
      }),
    );
    expect(smart).toMatchObject({ kind: "smart", count: 0 });
    await log(asAlice, a.contact.id, "2026-06-01T00:00:00Z");
    expect(
      (
        await listContacts(asAlice, {
          filter: {},
          listId: smart.id,
          sort: "name",
          limit: 10,
        })
      ).items.map((contact) => contact.id),
    ).toEqual([a.contact.id]);
    expect(
      (
        await listContacts(asBob, {
          filter: {},
          listId: smart.id,
          sort: "name",
          limit: 10,
        })
      ).total,
    ).toBe(0);
    await expect(
      inContactTransaction((tx) =>
        updateContactListMembers(tx, asAlice, smart.id, {
          add: [b.contact.id],
          remove: [],
        }),
      ),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      inContactTransaction((tx) =>
        createContactList(tx, asAlice, {
          name: "Nested",
          color: "gray",
          smartFilter: { listIds: [smart.id] },
        }),
      ),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      inContactTransaction((tx) => deleteContactList(tx, asAlice, list.id)),
    ).rejects.toMatchObject({ status: 409 });
    await inContactTransaction((tx) =>
      deleteContactList(tx, asAlice, smart.id),
    );
    await inContactTransaction((tx) => deleteContactList(tx, asAlice, list.id));
  });

  it("filters by stage, who knows them, follow-up, staleness, channel and search", async () => {
    const now = Date.now();
    const days = (count: number) =>
      new Date(now - count * 86_400_000).toISOString();
    const stale = await create(asAlice, {
      name: "Filter Stale",
      stage: "INVESTOR",
      followUpAt: "2020-01-01",
      channels: [{ type: "GITHUB", value: "https://github.com/FilterStale" }],
    });
    await log(asAlice, stale.contact.id, days(200));
    const fresh = await create(asAlice, {
      name: "Filter Fresh",
      stage: "PROSPECT",
      organization: "Filterworks",
    });
    await log(asBob, fresh.contact.id, days(2));
    const query = (filter: Parameters<typeof listContacts>[1]["filter"]) =>
      listContacts(asAlice, { filter, sort: "name", limit: 50 }).then((page) =>
        page.items
          .map((contact) => contact.name)
          .filter((name) => name.startsWith("Filter")),
      );
    expect(await query({ stages: ["INVESTOR"] })).toEqual(["Filter Stale"]);
    expect(await query({ knownByMe: true })).toEqual(["Filter Stale"]);
    expect(await query({ followUpDue: true })).toEqual(["Filter Stale"]);
    expect(await query({ lastContactOlderThanDays: 90 })).toEqual([
      "Filter Stale",
    ]);
    expect(await query({ knownByUserId: bob })).toContain("Filter Fresh");
    expect(await query({ hasChannel: "GITHUB" })).toEqual(["Filter Stale"]);
    expect(await query({ search: "filterstale" })).toEqual(["Filter Stale"]);
    expect(await query({ search: "filterworks" })).toEqual(["Filter Fresh"]);
    expect(await query({ createdWithinDays: 1 })).toEqual([
      "Filter Fresh",
      "Filter Stale",
    ]);
  });

  it("derives the reply state from directions and filters by it", async () => {
    const now = Date.now();
    const days = (count: number) =>
      new Date(now - count * 86_400_000).toISOString();
    const touch = (
      contactId: string,
      when: string,
      direction: "IN" | "OUT" | "BOTH" | null,
      sourceRef: string,
    ) =>
      inContactTransaction((tx) =>
        logContactInteraction(tx, asAlice, contactId, {
          occurredAt: when,
          channel: "EMAIL",
          direction,
          summary: "Reply state",
          sourceRef,
        }),
      );
    const ignored = await create(asAlice, { name: "Reply Ignored" });
    await touch(ignored.contact.id, days(21), "OUT", "reply-ignored-1");
    await touch(ignored.contact.id, days(12), "OUT", "reply-ignored-2");
    const waiting = await create(asAlice, { name: "Reply Waiting" });
    await touch(waiting.contact.id, days(2), "OUT", "reply-waiting-1");
    const talking = await create(asAlice, { name: "Reply Talking" });
    await touch(talking.contact.id, days(5), "OUT", "reply-talking-1");
    await touch(talking.contact.id, days(4), "IN", "reply-talking-2");
    const met = await create(asAlice, { name: "Reply Met" });
    await touch(met.contact.id, days(60), "OUT", "reply-met-1");
    await touch(met.contact.id, days(50), "BOTH", "reply-met-2");
    await touch(met.contact.id, days(1), null, "reply-met-3");

    const stored = await prisma.contact.findUniqueOrThrow({
      where: { id: ignored.contact.id },
    });
    // The clock runs from the first unanswered outreach, not the nudge.
    expect(stored.awaitingReplySince?.toISOString()).toBe(days(21));
    expect(stored.lastInboundAt).toBeNull();

    const states = async (
      filter: Parameters<typeof listContacts>[1]["filter"],
    ) =>
      (await listContacts(asAlice, { filter, sort: "name", limit: 100 })).items
        .filter((contact) => contact.name.startsWith("Reply "))
        .map((contact) => [contact.name, contact.replyState]);
    expect(await states({})).toEqual([
      ["Reply Ignored", "NO_REPLY"],
      ["Reply Met", "REPLIED"],
      ["Reply Talking", "IN_CONVERSATION"],
      ["Reply Waiting", "AWAITING_REPLY"],
    ]);
    expect(await states({ replyStates: ["NO_REPLY"] })).toEqual([
      ["Reply Ignored", "NO_REPLY"],
    ]);
    expect(
      await states({ replyStates: ["AWAITING_REPLY", "IN_CONVERSATION"] }),
    ).toEqual([
      ["Reply Talking", "IN_CONVERSATION"],
      ["Reply Waiting", "AWAITING_REPLY"],
    ]);

    // Their answer clears the wait in the same transaction.
    await touch(ignored.contact.id, days(0), "IN", "reply-ignored-3");
    expect(
      (
        await prisma.contact.findUniqueOrThrow({
          where: { id: ignored.contact.id },
        })
      ).awaitingReplySince,
    ).toBeNull();
  });

  it("files a captured practice inbox as an organization and new people as plain contacts", async () => {
    const capture = (name: string, email: string, sourceRef: string) =>
      inContactTransaction((tx) =>
        captureContactInteraction(tx, asAlice, {
          name,
          channels: [{ type: "EMAIL", value: email }],
          interaction: {
            occurredAt: "2026-10-01T08:00:00Z",
            channel: "EMAIL",
            direction: "OUT",
            summary: "Terminanfrage",
            sourceRef,
          },
          teammateUserId: alice,
        }),
      );
    const praxis = await capture("Praxis", "info@praxis-kind.test", "kind-1");
    const person = await capture("Anna Kind", "anna@kind.test", "kind-2");
    expect(praxis.contact).toMatchObject({
      kind: "ORGANIZATION",
      stage: "CONTACT",
    });
    expect(person.contact).toMatchObject({ kind: "PERSON", stage: "CONTACT" });
    const { items } = await listContacts(asAlice, {
      filter: { kind: "ORGANIZATION" },
      sort: "name",
      limit: 100,
    });
    expect(items.map((contact) => contact.name)).toContain("Praxis");
    expect(items.map((contact) => contact.name)).not.toContain("Anna Kind");
  });

  it("pages through contacts sorted by last contact with never-contacted last", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    let total = 0;
    do {
      const page = await listContacts(asAlice, {
        filter: {},
        sort: "lastContactAt",
        direction: "desc",
        cursor,
        limit: 3,
      });
      total = page.total;
      seen.push(...page.items.map((contact) => contact.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    const rows = await prisma.contact.findMany({
      where: { id: { in: seen } },
      select: { id: true, lastContactAt: true },
    });
    const dates = seen.map(
      (id) =>
        rows.find((row) => row.id === id)?.lastContactAt?.getTime() ?? null,
    );
    const firstEmpty = dates.indexOf(null);
    expect(firstEmpty).toBeGreaterThan(0);
    expect(dates.slice(firstEmpty).every((date) => date === null)).toBe(true);
    const contacted = dates.slice(0, firstEmpty) as number[];
    expect(contacted).toEqual([...contacted].sort((a, b) => b - a));
  });

  it("finds same-name duplicates and captures an interaction idempotently", async () => {
    await create(asAlice, { name: "Jon Duplicate" });
    await create(asBob, { name: " jon duplicate" });
    const groups = await findDuplicateContacts(asAlice);
    expect(
      groups.find((group) => group.name === "Jon Duplicate")?.contacts,
    ).toHaveLength(2);

    const capture = () =>
      inContactTransaction((tx) =>
        captureContactInteraction(tx, asAlice, {
          name: "Captured Person",
          channels: [{ type: "EMAIL", value: "captured@example.test" }],
          interaction: {
            occurredAt: "2026-09-01T08:00:00Z",
            channel: "MEETING",
            summary: "Intro call",
            sourceRef: "event-123",
          },
          teammateUserId: bob,
        }),
      );
    const first = await capture();
    const second = await capture();
    expect(first).toMatchObject({ created: true, interactionCreated: true });
    expect(second).toMatchObject({ created: false, interactionCreated: false });
    expect(second.contact).toMatchObject({
      id: first.contact.id,
      interactionCount: 1,
      knownBy: [{ id: bob }],
      channels: [{ source: "CALENDAR" }],
    });
  });

  it("removes a primary channel and promotes the next one", async () => {
    const { contact } = await create(asAlice, {
      name: "Two Mails",
      channels: [
        { type: "EMAIL", value: "a@two-mails.test" },
        { type: "EMAIL", value: "b@two-mails.test" },
      ],
    });
    const primary = contact.channels.find((channel) => channel.isPrimary);
    const after = await inContactTransaction((tx) =>
      removeContactChannel(tx, asAlice, contact.id, primary?.id ?? ""),
    );
    expect(after.channels).toMatchObject([
      { value: "b@two-mails.test", isPrimary: true },
    ]);
  });

  it("imports a Files table twice with the same result, and exports CSV", async () => {
    const column = (name: string, type: string, position: number) => ({
      id: randomUUID(),
      name,
      type,
      position,
    });
    const columns = {
      name: column("Name", "text", 0),
      organization: column("Organization", "text", 1),
      email: column("Email", "email", 2),
      relationship: column("Relationship", "long_text", 3),
      first: column("First contact", "date", 4),
      linkedin: column("LinkedIn", "url", 5),
      location: column("Location", "text", 6),
      tags: column("Tags", "multiple_select", 7),
    };
    const table = await prisma.dataTable.create({
      data: {
        workspaceId,
        title: "Personal CRM",
        createdBy: alice,
        columns: { create: Object.values(columns) },
      },
    });
    const rows = [
      {
        [columns.name.id]: "Import Ada",
        [columns.organization.id]: "Analytical Engines",
        [columns.email.id]: "ada@engines.test, ADA@personal.test",
        [columns.relationship.id]: "Met at a conference",
        [columns.first.id]: "2024-05-01",
        [columns.linkedin.id]: "linkedin.com/in/ada-import",
        [columns.location.id]: "London",
        [columns.tags.id]: ["Investors", "Friends"],
      },
      {
        [columns.name.id]: "Import NoChannel",
        [columns.tags.id]: ["Friends"],
      },
      // Tom already exists by email; only empty fields get filled.
      {
        [columns.name.id]: "Tom Imported",
        [columns.email.id]: "tom@acme.test",
        [columns.location.id]: "Basel",
      },
      { [columns.relationship.id]: "no name, no channel" },
    ];
    for (const [index, values] of rows.entries())
      await prisma.tableRow.create({
        data: { tableId: table.id, values, position: index },
      });
    const mapping = {
      name: "Name",
      organization: "organization",
      email: "Email",
      summary: "Relationship",
      firstContactAt: columns.first.id,
      linkedin: "LinkedIn",
      location: "Location",
      lists: "Tags",
    };
    const first = await importContactsFromTable(asAlice, {
      tableId: table.id,
      mapping,
    });
    expect(first).toEqual({
      rows: 4,
      created: 2,
      updated: 1,
      unchanged: 0,
      skipped: 1,
      listsCreated: 1,
      mergeSuggestions: [],
    });
    const second = await importContactsFromTable(asAlice, {
      tableId: table.id,
      mapping,
    });
    expect(second).toEqual({
      rows: 4,
      created: 0,
      updated: 0,
      unchanged: 3,
      skipped: 1,
      listsCreated: 0,
      mergeSuggestions: [],
    });
    const ada = (
      await listContacts(asAlice, {
        filter: { search: "Import Ada" },
        sort: "name",
        limit: 5,
      })
    ).items;
    expect(ada).toHaveLength(1);
    expect(ada[0]).toMatchObject({
      organization: "Analytical Engines",
      summary: "Met at a conference",
      location: "London",
      interactionCount: 1,
      firstContactAt: new Date("2024-05-01T00:00:00.000Z"),
    });
    expect(ada[0]?.channels.map((channel) => channel.value).sort()).toEqual([
      "ada@engines.test",
      "ada@personal.test",
      "https://www.linkedin.com/in/ada-import",
    ]);
    expect(ada[0]?.lists.map((list) => list.name).sort()).toEqual([
      "Friends",
      "Investors",
    ]);
    const tom = (
      await listContacts(asAlice, {
        filter: { search: "tom@acme.test" },
        sort: "name",
        limit: 5,
      })
    ).items[0];
    expect(tom).toMatchObject({ name: "Tom Berger", location: "Basel" });
    await expect(
      importContactsFromTable(asAlice, {
        tableId: table.id,
        mapping: { name: "Missing column" },
      }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      importContactsFromTable(asOutsider, { tableId: table.id, mapping }),
    ).rejects.toMatchObject({ status: 404 });

    const csv = await exportContactsCsv(asAlice, {
      filter: { search: "Import" },
      sort: "name",
    });
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain('"Name","Organization","Role","Stage","Emails"');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"Import Ada","Analytical Engines"');
    expect(lines[1]).toContain('"ada@engines.test; ada@personal.test"');
    expect(lines[1]).toContain('"Investors; Friends"');
  });
});
