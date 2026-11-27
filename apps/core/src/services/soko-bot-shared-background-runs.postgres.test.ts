/**
 * A shared Soko Bot's background runs against a disposable PostgreSQL
 * database: a member's chat request starts one in the bot's own workspace
 * and room, one at a time, and only that member or an owner stops it.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/core test src/services/soko-bot-shared-background-runs.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import prisma from "@/lib/db/prisma";

// Core's test setup drains recorded reconciliation work before fixture cleanup.
vi.mock("@vercel/functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/functions")>()),
  waitUntil: vi.fn(),
}));

// The flow publishes over Ably; the test env has no real key.
vi.mock("@/lib/ably/client", async () =>
  (await import("@/test/ably-client")).fakeAblyClientModule(),
);
// Funding has its own tests; here every turn may start.
vi.mock("@/services/soko-bot-billing.service", async (original) => ({
  ...(await original<object>()),
  requireSokoBotTurnFunding: async () => undefined,
}));

import { sokoBotRuntimeService } from "./soko-bot-runtime.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const HOUR = 60 * 60 * 1_000;
const RUN_TOOLS = [
  "start_background_run",
  "list_background_runs",
  "stop_background_run",
  "list_tables",
];

describe.skipIf(!enabled)("a shared Soko Bot's background runs", () => {
  const organizationId = randomUUID();
  const outsideOrganizationId = randomUUID();
  let workspaceId: string;
  let roomId: string;
  let botId: string;
  const people: Record<"owner" | "ada" | "bob" | "outsider", string> = {
    owner: randomUUID(),
    ada: randomUUID(),
    bob: randomUUID(),
    outsider: randomUUID(),
  };

  async function person(id: string, organization: string, role: string) {
    await prisma.user.create({
      data: {
        id,
        name: `${role} fixture`,
        email: `${id}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await prisma.member.create({
      data: { userId: id, organizationId: organization, role },
    });
  }

  /** A live chat turn of the bot, asked by a member (or by nobody). */
  async function liveTurn(
    by: string | null,
    source: "CHAT" | "SCHEDULE" = "CHAT",
  ) {
    return prisma.sokoBotTurn.create({
      data: {
        network: "mainnet",
        sokoBotId: botId,
        requestedByUserId: by,
        askedByUserId: by,
        workspaceId,
        source,
        status: "RUNNING",
        clientTurnId: randomUUID(),
        userMessage: "Fixture turn",
        capabilityNames: RUN_TOOLS,
        destinationRoomId: roomId,
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

  const start = (turnId: string, title = "Outreach list") =>
    tool(turnId, "start_background_run", {
      title,
      brief: "Build the outreach list from our contacts.",
    }) as Promise<{ runId: string }>;

  beforeAll(async () => {
    for (const id of [organizationId, outsideOrganizationId])
      await prisma.organization.create({
        data: { id, name: "Runs fixture", slug: id },
      });
    await person(people.owner, organizationId, "owner");
    await person(people.ada, organizationId, "member");
    await person(people.bob, organizationId, "member");
    await person(people.outsider, outsideOrganizationId, "owner");
    workspaceId = (await prisma.workspace.create({ data: { organizationId } }))
      .id;
    const project = await prisma.project.create({
      data: { workspaceId, name: "Marketing" },
    });
    roomId = (
      await prisma.chatRoom.create({
        data: {
          kind: "channel",
          name: "Shared bot",
          slug: `shared-${organizationId}`,
          discoverability: "public",
          organizationId,
          createdByUserId: people.owner,
        },
      })
    ).id;
    botId = (
      await prisma.sokoBot.create({
        data: {
          workspaceId,
          projectId: project.id,
          userId: null,
          createdByUserId: people.owner,
          sharedRoomId: roomId,
          name: "Team bot",
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.sokoBot.deleteMany({ where: { id: botId } });
    await prisma.chatRoom.deleteMany({ where: { id: roomId } });
    await prisma.project.deleteMany({ where: { workspaceId } });
    await prisma.organization.deleteMany({
      where: { id: { in: [organizationId, outsideOrganizationId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: Object.values(people) } },
    });
    await prisma.$disconnect();
  });

  it("starts the member's run in the bot's own workspace and room, one at a time", async () => {
    const turn = await liveTurn(people.ada);
    const { runId } = await start(turn.id);

    await expect(
      prisma.sokoBotTurn.findUniqueOrThrow({ where: { id: runId } }),
    ).resolves.toMatchObject({
      sokoBotId: botId,
      workspaceId,
      parentTurnId: turn.id,
      requestedByUserId: people.ada,
      askedByUserId: people.ada,
      source: "CHAT",
      backgroundTitle: "Outreach list",
      destinationRoomId: roomId,
    });
    const run = await prisma.sokoBotTurn.findUniqueOrThrow({
      where: { id: runId },
      select: { capabilityNames: true },
    });
    expect(run.capabilityNames).toContain("list_tables");
    expect(run.capabilityNames).not.toContain("start_background_run");

    const again = await liveTurn(people.bob);
    await expect(start(again.id, "Results log")).rejects.toThrow(
      '"Outreach list" is still running',
    );

    // Bob did not start it and is no owner or admin: he cannot stop it.
    await expect(
      tool(again.id, "stop_background_run", { runId }),
    ).rejects.toThrow("Only the member who asked");
    await expect(
      prisma.sokoBotTurn.findUniqueOrThrow({
        where: { id: runId },
        select: { cancellationRequestedAt: true },
      }),
    ).resolves.toEqual({ cancellationRequestedAt: null });

    // Ada, who started it, can.
    await expect(
      tool(turn.id, "stop_background_run", { runId }),
    ).resolves.toMatchObject({ runId, stopped: true });
  });

  it("starts none from the bot's own rhythm, or for someone outside the organization", async () => {
    const rhythm = await liveTurn(null, "SCHEDULE");
    await expect(start(rhythm.id)).rejects.toThrow(
      "Only a member's own request in chat",
    );
    const outsider = await liveTurn(people.outsider);
    await expect(start(outsider.id, "Outsider's")).rejects.toThrow();
    await expect(
      prisma.sokoBotTurn.count({
        where: { sokoBotId: botId, backgroundTitle: "Outsider's" },
      }),
    ).resolves.toBe(0);
  });
});
