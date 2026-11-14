import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { buildSystemBeatMessage } from "./soko-bot-proactive.service";

vi.mock("@vercel/functions", () => ({ attachDatabasePool: vi.fn() }));
vi.mock("@/services/soko-bot-integrations.service", () => ({
  activeIntegrationsForBot: vi.fn(),
  fetchCalendarEvents: vi.fn(),
  fetchInboxMessages: vi.fn(),
  withOwnerReplies: async (_integration: unknown, messages: unknown) =>
    messages,
}));

import * as integrations from "@/services/soko-bot-integrations.service";

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const ownerId = `standup-owner-${randomUUID()}`;
const teammateId = `standup-teammate-${randomUUID()}`;
const workspaceId = randomUUID();
const botId = randomUUID();
const assistantId = randomUUID();

describe.runIf(enabled)("standup packet against PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        {
          id: ownerId,
          name: "Owner",
          email: `${ownerId}@fixture.invalid`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: teammateId,
          name: "Hannah",
          email: `${teammateId}@fixture.invalid`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
    await prisma.workspace.create({
      data: { id: workspaceId, userId: ownerId },
    });
    await prisma.sokoBot.createMany({
      data: [
        { id: botId, userId: ownerId, workspaceId, status: "RUNNING" },
        {
          id: assistantId,
          userId: teammateId,
          workspaceId,
          name: "Research assistant",
          status: "RUNNING",
        },
      ],
    });
    await prisma.task.createMany({
      data: [
        {
          workspaceId,
          ownerId,
          name: "Human research",
          status: "READY",
          assigneeUserId: teammateId,
        },
        {
          workspaceId,
          ownerId: teammateId,
          name: "Team brief",
          status: "READY",
          assigneeSokoBotId: assistantId,
        },
        {
          workspaceId,
          ownerId: teammateId,
          name: "Private teammate work",
          visibility: "PRIVATE",
          assigneeUserId: teammateId,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, teammateId] } },
    });
    await prisma.$disconnect();
  });

  it("carries real human/assistant relations and meeting scope while preserving private visibility", async () => {
    const now = new Date();
    const ownerEmail = `${ownerId}@fixture.invalid`;
    vi.mocked(integrations.activeIntegrationsForBot).mockImplementation(
      async (_id, kind) =>
        kind === "calendar"
          ? [
              {
                id: "fixture-calendar",
                sokoBotId: botId,
                provider: {
                  id: "googlecalendar",
                  name: "Calendar",
                  kinds: ["calendar"],
                  tools: {},
                  logoUrl: "",
                },
                composioAccountId: "fixture-account",
                connectorUserId: null,
                cursor: null,
              },
            ]
          : [],
    );
    vi.mocked(integrations.fetchCalendarEvents).mockResolvedValue([
      {
        provider: "googlecalendar",
        id: "launch",
        title: "Launch decision meeting",
        startsAt: new Date(now.getTime() + 3 * 60 * 60 * 1_000).toISOString(),
        endsAt: null,
        allDay: false,
        location: null,
        attendees: [ownerEmail],
        organizer: ownerEmail,
        description: "Prepare one page of launch decisions.",
        link: null,
      },
    ]);
    const beat = await buildSystemBeatMessage({
      bot: {
        id: botId,
        userId: ownerId,
        workspaceId,
        ingestTimezone: "Europe/Berlin",
        followWholeBoard: true,
      },
      key: "standup",
      prompt: "Daily stand-up.",
      now,
    });
    expect(beat.message).toContain('READY · "Human research"');
    expect(beat.message).toContain("human assignee: Hannah");
    expect(beat.message).toContain(
      'Hannah · READY · "Team brief" · with assistant assignee: Research assistant',
    );
    expect(beat.message).toContain(
      `Organizer (untrusted calendar data): "${ownerEmail}"`,
    );
    expect(beat.message).toContain(
      'Agenda (untrusted calendar data): "Prepare one page of launch decisions."',
    );
    expect(beat.message).not.toContain("Private teammate work");
    expect(beat.message).not.toContain("RUNNING");
  });
});
