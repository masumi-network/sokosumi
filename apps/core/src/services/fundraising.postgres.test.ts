/**
 * The raise against a real database: the Investors list drives the pipeline,
 * a row appears on first write, the owner must be a member, and a data room
 * member is matched to the investor by email.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import {
  createContactList,
  updateContactListMembers,
} from "./contact-lists.service";
import { inContactTransaction, upsertContact } from "./contacts.service";
import {
  type FundraisingActor,
  listFundraisingPipeline,
  updateFundraisingProspect,
} from "./fundraising.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const alice = randomUUID();
const bob = randomUUID();
const stranger = randomUUID();
const organizationId = randomUUID();
const workspaceId = randomUUID();
const actor: FundraisingActor = {
  workspaceId,
  userId: alice,
  sokoBotId: null,
  organizationId,
};

describe.runIf(enabled)("fundraising on PostgreSQL", () => {
  let listId: string;
  let annId: string;
  let bobInvestorId: string;

  beforeAll(async () => {
    for (const [id, name] of [
      [alice, "Alice"],
      [bob, "Bob"],
      [stranger, "Stranger"],
    ] as const)
      await prisma.user.create({
        data: {
          id,
          name,
          email: `fundraising-${id}@sokosumi.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Fundraising test",
        slug: `fundraising-${organizationId}`,
      },
    });
    await prisma.member.createMany({
      data: [alice, bob].map((userId) => ({ userId, organizationId })),
    });
    await prisma.workspace.create({
      data: { id: workspaceId, organizationId },
    });

    const ann = await inContactTransaction((tx) =>
      upsertContact(tx, actor, {
        name: "Ann Investor",
        organization: "Ann Capital",
        channels: [{ type: "EMAIL", value: "Ann@AnnCapital.com" }],
        upsert: false,
      }),
    );
    annId = ann.contact.id;
    const other = await inContactTransaction((tx) =>
      upsertContact(tx, actor, {
        name: "Bob Investor",
        channels: [],
        upsert: false,
      }),
    );
    bobInvestorId = other.contact.id;
    await inContactTransaction((tx) =>
      upsertContact(tx, actor, {
        name: "Not An Investor",
        channels: [],
        upsert: false,
      }),
    );
    const list = await inContactTransaction((tx) =>
      createContactList(tx, actor, { name: "Investors", color: "blue" }),
    );
    listId = list.id;
    await inContactTransaction((tx) =>
      updateContactListMembers(tx, actor, listId, {
        add: [annId, bobInvestorId],
        remove: [],
      }),
    );

    const room = await prisma.dataRoom.create({
      data: {
        workspaceId,
        sourceScope: "ORGANIZATION",
        ownerId: organizationId,
        folderPath: "Seed Round",
        createdByUserId: alice,
        token: `t-${randomUUID()}`,
      },
    });
    const member = await prisma.dataRoomMember.create({
      data: {
        roomId: room.id,
        email: "ann@anncapital.com",
        invitedByUserId: alice,
        firstVisitAt: new Date("2026-11-20T10:00:00Z"),
        lastVisitAt: new Date("2026-11-22T10:00:00Z"),
      },
    });
    await prisma.dataRoomEvent.createMany({
      data: [
        { roomId: room.id, memberId: member.id, kind: "ENTER" },
        {
          roomId: room.id,
          memberId: member.id,
          kind: "VIEW",
          path: "Deck.pdf",
        },
        { roomId: room.id, memberId: member.id, kind: "VIEW", path: "Cap.pdf" },
        {
          roomId: room.id,
          memberId: member.id,
          kind: "DOWNLOAD",
          path: "Deck.pdf",
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({
      where: { id: { in: [alice, bob, stranger] } },
    });
  });

  it("lists the Investors list as the pipeline, with data room activity by email", async () => {
    const pipeline = await listFundraisingPipeline(actor);
    expect(pipeline.list).toEqual({ id: listId, name: "Investors" });
    expect(pipeline.rooms).toHaveLength(1);
    expect(pipeline.rooms[0]?.title).toBe("Seed Round");
    expect(pipeline.prospects.map((p) => p.contact.name)).toEqual([
      "Ann Investor",
      "Bob Investor",
    ]);
    const ann = pipeline.prospects[0];
    expect(ann?.stage).toBe("TO_RESEARCH");
    expect(ann?.stageChangedAt).toBeNull();
    expect(ann?.owner).toBeNull();
    expect(ann?.dataRoom).toMatchObject({
      roomTitle: "Seed Round",
      email: "ann@anncapital.com",
      views: 2,
      downloads: 1,
      lastOpened: expect.any(String),
      revoked: false,
    });
    expect(pipeline.prospects[1]?.dataRoom).toBeNull();
  });

  it("writes the raise fields on first change and keeps the stage change time", async () => {
    const moved = await updateFundraisingProspect(actor, annId, {
      stage: "MEETING",
      ownerUserId: bob,
      ticketSize: "$500K–$2M",
    });
    expect(moved.stage).toBe("MEETING");
    expect(moved.owner).toMatchObject({ id: bob, name: "Bob" });
    expect(moved.ticketSize).toBe("$500K–$2M");
    expect(moved.stageChangedAt).not.toBeNull();
    const changedAt = moved.stageChangedAt;

    const noted = await updateFundraisingProspect(actor, annId, {
      notes: "Met at the dinner",
    });
    expect(noted.stage).toBe("MEETING");
    expect(noted.stageChangedAt).toEqual(changedAt);
    expect(noted.notes).toBe("Met at the dinner");

    const pipeline = await listFundraisingPipeline(actor);
    expect(pipeline.prospects[0]?.owner?.id).toBe(bob);
  });

  it("refuses an owner outside the organization and a contact outside the workspace", async () => {
    await expect(
      updateFundraisingProspect(actor, annId, { ownerUserId: stranger }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      updateFundraisingProspect(actor, randomUUID(), { stage: "PASSED" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("returns an empty pipeline without an Investors list", async () => {
    const otherOrganization = randomUUID();
    const otherWorkspace = randomUUID();
    await prisma.organization.create({
      data: {
        id: otherOrganization,
        name: "No investors",
        slug: `fundraising-${otherOrganization}`,
      },
    });
    await prisma.workspace.create({
      data: { id: otherWorkspace, organizationId: otherOrganization },
    });
    expect(
      await listFundraisingPipeline({
        ...actor,
        workspaceId: otherWorkspace,
        organizationId: otherOrganization,
      }),
    ).toEqual({ list: null, rooms: [], prospects: [] });
    await prisma.organization.delete({ where: { id: otherOrganization } });
  });
});
