/**
 * A shared Soko Bot's tables and contacts against a disposable PostgreSQL
 * database: a Project's bot works in its own Project and organization, and
 * never reaches another Project's or another organization's rows.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/core test src/services/soko-bot-shared-tables.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { CMO_SOKO_BOT_VERSION_ID } from "@sokosumi/soko-bot";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import prisma from "@/lib/db/prisma";

// The flow publishes over Ably; the test env has no real key.
vi.mock("@/lib/ably/client", async () =>
  (await import("@/test/ably-client")).fakeAblyClientModule(),
);

import { sokoBotRuntimeService } from "./soko-bot-runtime.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const HOUR = 60 * 60 * 1_000;
const TABLE_TOOLS = [
  "list_tables",
  "read_table",
  "create_table",
  "write_table_rows",
  "export_contacts_to_table",
  "search_contacts",
  "list_contact_lists",
  "manage_contact_lists",
];

interface Business {
  organizationId: string;
  workspaceId: string;
  ownerId: string;
  projectId: string;
  botId: string;
}

/** An organization with an owner, one Project and that Project's shared bot. */
async function business(name: string): Promise<Business> {
  const ownerId = randomUUID();
  const organizationId = randomUUID();
  const workspaceId = randomUUID();
  await prisma.user.create({
    data: {
      id: ownerId,
      name: `${name} owner`,
      email: `${ownerId}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await prisma.organization.create({
    data: {
      id: organizationId,
      slug: organizationId,
      name,
      workspace: { create: { id: workspaceId } },
      members: {
        create: { userId: ownerId, role: "owner", seatAssignedAt: new Date() },
      },
    },
  });
  const project = await prisma.project.create({
    data: { workspaceId, name: `${name} marketing` },
  });
  const bot = await prisma.sokoBot.create({
    data: {
      workspaceId,
      projectId: project.id,
      userId: null,
      createdByUserId: ownerId,
      versionId: CMO_SOKO_BOT_VERSION_ID,
      name: "Cuso",
    },
  });
  return {
    organizationId,
    workspaceId,
    ownerId,
    projectId: project.id,
    botId: bot.id,
  };
}

/** A live turn of the business's bot, asked by a member or by nobody. */
async function liveTurn(
  of: Business,
  asked: { by: string | null; source?: "CHAT" | "SCHEDULE" },
) {
  return prisma.sokoBotTurn.create({
    data: {
      network: "mainnet",
      sokoBotId: of.botId,
      requestedByUserId: asked.by,
      askedByUserId: asked.by,
      workspaceId: of.workspaceId,
      source: asked.source ?? "CHAT",
      status: "RUNNING",
      clientTurnId: randomUUID(),
      userMessage: "Fixture turn",
      capabilityNames: TABLE_TOOLS,
      deadlineAt: new Date(Date.now() + HOUR),
      leaseExpiresAt: new Date(Date.now() + HOUR),
      contextSnapshot: {
        create: {
          generatedAt: new Date(),
          schemaVersion: 1,
          hash: "fixture",
          packet: { memory: { version: 0 } },
          byteSize: 0,
          tokenEstimate: 0,
          counts: {},
          omissions: {},
        },
      },
    },
  });
}

function tool(turnId: string, capability: string, input: unknown) {
  return sokoBotRuntimeService.executeTool({
    sessionId: `session-${turnId}`,
    turnId,
    capability: capability as never,
    toolCallId: randomUUID(),
    input,
  });
}

const NAME = randomUUID();
const tableInput = (title: string, extra: object = {}) => ({
  key: randomUUID(),
  title,
  columns: [{ id: NAME, name: "Name", type: "text" }],
  rows: [{ values: { [NAME]: "Crossmint" } }],
  ...extra,
});

describe.skipIf(!enabled)("a shared Soko Bot's tables and contacts", () => {
  let acme: Business;
  let other: Business;
  /** A second Project in Acme, with a table of its own. */
  let sideProjectId: string;
  let sideTableId: string;
  let otherTableId: string;

  beforeAll(async () => {
    acme = await business("Acme");
    other = await business("Other");
    sideProjectId = (
      await prisma.project.create({
        data: { workspaceId: acme.workspaceId, name: "Acme side project" },
      })
    ).id;
    const column = { name: "Name", type: "text", position: 0 };
    sideTableId = (
      await prisma.dataTable.create({
        data: {
          workspaceId: acme.workspaceId,
          projectId: sideProjectId,
          title: "Side project leads",
          createdBy: acme.ownerId,
          columns: { create: column },
        },
      })
    ).id;
    otherTableId = (
      await prisma.dataTable.create({
        data: {
          workspaceId: other.workspaceId,
          projectId: other.projectId,
          title: "Other's results",
          createdBy: other.ownerId,
          columns: { create: column },
        },
      })
    ).id;
    await prisma.contact.createMany({
      data: [
        { workspaceId: acme.workspaceId, name: "Ada of Acme" },
        { workspaceId: other.workspaceId, name: "Olaf of Other" },
      ],
    });
  });

  afterAll(async () => {
    for (const { organizationId, workspaceId, ownerId, botId } of [
      acme,
      other,
    ]) {
      await prisma.dataTable.deleteMany({ where: { workspaceId } });
      await prisma.contact.deleteMany({ where: { workspaceId } });
      await prisma.sokoBot.deleteMany({ where: { id: botId } });
      await prisma.project.deleteMany({ where: { workspaceId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
    }
    await prisma.$disconnect();
  });

  it("creates a table in its own Project, as the bot, for the member who asked", async () => {
    const turn = await liveTurn(acme, { by: acme.ownerId });
    const created = await tool(
      turn.id,
      "create_table",
      tableInput("Competitors"),
    );
    const tableId = (created as { table: { id: string } }).table.id;

    await expect(
      prisma.dataTable.findUniqueOrThrow({ where: { id: tableId } }),
    ).resolves.toMatchObject({
      workspaceId: acme.workspaceId,
      projectId: acme.projectId,
      createdBy: acme.botId,
      title: "Competitors",
    });

    const read = await tool(turn.id, "read_table", { tableId });
    expect(JSON.stringify(read)).toContain("Crossmint");

    const written = await tool(turn.id, "write_table_rows", {
      tableId,
      key: randomUUID(),
      insert: [{ values: { [NAME]: "Venly" } }],
    });
    expect(JSON.stringify(written)).toContain("Venly");
  });

  it("lists only its own Project's tables", async () => {
    const turn = await liveTurn(acme, { by: acme.ownerId });
    const listed = JSON.stringify(await tool(turn.id, "list_tables", {}));

    expect(listed).toContain("Competitors");
    expect(listed).not.toContain("Side project leads");
    expect(listed).not.toContain("Other's results");
  });

  it("cannot read or write another Project's table, in its own organization or another", async () => {
    const turn = await liveTurn(acme, { by: acme.ownerId });
    for (const tableId of [sideTableId, otherTableId]) {
      await expect(tool(turn.id, "read_table", { tableId })).rejects.toThrow(
        "Table not found",
      );
      await expect(
        tool(turn.id, "write_table_rows", {
          tableId,
          key: randomUUID(),
          insert: [{ values: {} }],
        }),
      ).rejects.toThrow("Table not found");
    }
  });

  it("cannot create a table in another Project", async () => {
    const turn = await liveTurn(acme, { by: acme.ownerId });
    for (const projectId of [sideProjectId, other.projectId]) {
      await expect(
        tool(turn.id, "create_table", tableInput("Elsewhere", { projectId })),
      ).rejects.toThrow("can only be created in the bot's own Project");
    }
    await expect(
      prisma.dataTable.count({ where: { title: "Elsewhere" } }),
    ).resolves.toBe(0);
  });

  it("refuses a turn nobody asked for, and a member of another organization", async () => {
    const alone = await liveTurn(acme, { by: null, source: "SCHEDULE" });
    await expect(tool(alone.id, "list_tables", {})).rejects.toThrow(
      "nobody asked for this turn",
    );

    const outsider = await liveTurn(acme, { by: other.ownerId });
    await expect(tool(outsider.id, "list_tables", {})).rejects.toThrow(
      "Workspace access is no longer available",
    );
    await expect(
      tool(outsider.id, "create_table", tableInput("Outsider's")),
    ).rejects.toThrow("Workspace access is no longer available");
  });

  it("reads its own organization's contacts, never another's", async () => {
    const turn = await liveTurn(acme, { by: acme.ownerId });
    const found = JSON.stringify(await tool(turn.id, "search_contacts", {}));
    expect(found).toContain("Ada of Acme");
    expect(found).not.toContain("Olaf of Other");

    const outsider = await liveTurn(acme, { by: other.ownerId });
    await expect(tool(outsider.id, "search_contacts", {})).rejects.toThrow(
      "Workspace access is no longer available",
    );
  });

  it("exports its organization's contacts into a table of its own Project", async () => {
    const turn = await liveTurn(acme, { by: acme.ownerId });
    const exported = (await tool(turn.id, "export_contacts_to_table", {
      title: "Everyone we know",
    })) as { table: { id: string }; rows: number };

    expect(exported.rows).toBe(1);
    await expect(
      prisma.dataTable.findUniqueOrThrow({
        where: { id: exported.table.id },
      }),
    ).resolves.toMatchObject({
      workspaceId: acme.workspaceId,
      projectId: acme.projectId,
      createdBy: acme.botId,
    });
    const rows = JSON.stringify(
      await tool(turn.id, "read_table", { tableId: exported.table.id }),
    );
    expect(rows).toContain("Ada of Acme");
    expect(rows).not.toContain("Olaf of Other");
  });

  it("keeps the contact lists it makes in its own organization", async () => {
    const turn = await liveTurn(acme, { by: acme.ownerId });
    await tool(turn.id, "manage_contact_lists", {
      action: "create",
      name: "Press",
    });
    await expect(
      prisma.contactList.findMany({
        where: { name: "Press" },
        select: { workspaceId: true },
      }),
    ).resolves.toEqual([{ workspaceId: acme.workspaceId }]);

    const theirs = await liveTurn(other, { by: other.ownerId });
    expect(
      JSON.stringify(await tool(theirs.id, "list_contact_lists", {})),
    ).not.toContain("Press");
  });
});
