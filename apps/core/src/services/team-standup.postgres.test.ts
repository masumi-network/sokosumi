import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { runTeamStandup } from "./team-standup.service";

vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtimeById: vi.fn(async () => undefined),
}));
vi.mock("@/helpers/chat-human-mentions", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  emitChatMessageNotifications: vi.fn(async () => undefined),
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

async function organizationWith(name: string) {
  const suffix = randomUUID().slice(0, 8);
  const user = (who: string) =>
    prisma.user.create({
      data: {
        name: who,
        email: `${who.toLowerCase().replace(/\s/g, ".")}.${suffix}@standup.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      select: { id: true, name: true },
    });
  const robin = await user("Robin Keller");
  const hannah = await user("Hannah Weber");
  const organization = await prisma.organization.create({
    data: {
      name,
      slug: `standup-${suffix}`,
      members: {
        create: [
          { userId: robin.id, role: "owner" },
          { userId: hannah.id, role: "member" },
        ],
      },
      workspace: { create: {} },
    },
    select: { id: true, workspace: { select: { id: true } } },
  });
  const workspaceId = organization.workspace!.id;
  const vendor = await prisma.vendor.create({
    data: { name: "Standup test", slug: `standup-${suffix}` },
  });
  const mira = await prisma.coworker.create({
    data: {
      name: "Mira",
      slug: `mira-${suffix}`,
      capabilities: ["tasks", "chat"],
      vendorId: vendor.id,
    },
  });
  const bot = await prisma.sokoBot.create({
    data: {
      userId: robin.id,
      workspaceId,
      name: "Soko",
      joinsTeamStandup: true,
    },
    select: { id: true },
  });
  const standup = await prisma.teamStandup.create({
    data: { organizationId: organization.id, enabled: true },
  });
  return { robin, hannah, organization, workspaceId, mira, bot, standup };
}

describe.skipIf(!enabled)("team stand-up", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("posts nothing on a day with nothing new", async () => {
    const world = await organizationWith("Quiet Co");
    const outcome = await runTeamStandup({
      standupId: world.standup.id,
      scheduledFor: new Date(),
      host: async () => {
        throw new Error("the host is not asked on a quiet day");
      },
    });
    expect(outcome?.status).toBe("QUIET");
    expect(
      await prisma.chatRoomMessage.count({
        where: { room: { organizationId: world.organization.id } },
      }),
    ).toBe(0);
  });

  it("writes lines from Task states, mentions the person a blocker waits on, and opens the match's hand-off once", async () => {
    const world = await organizationWith("Busy Co");
    const task = (name: string, status: "RUNNING" | "INPUT_REQUIRED") =>
      prisma.task.create({
        data: {
          name,
          status,
          workspaceId: world.workspaceId,
          organizationId: world.organization.id,
          ownerId: world.robin.id,
          assigneeId: world.mira.id,
        },
      });
    await task("EU marketplace pricing research", "RUNNING");
    await task("Competitor note on Langdock", "INPUT_REQUIRED");
    await prisma.task.create({
      data: {
        name: "Private salary review",
        status: "RUNNING",
        visibility: "PRIVATE",
        workspaceId: world.workspaceId,
        organizationId: world.organization.id,
        ownerId: world.robin.id,
        assigneeId: world.mira.id,
      },
    });
    const dispatched: string[] = [];
    const slot = new Date();
    const run = () =>
      runTeamStandup({
        standupId: world.standup.id,
        scheduledFor: slot,
        dispatch: async (mentionId) => {
          dispatched.push(mentionId);
        },
        host: async ({ lines }) => ({
          summary: "Mira is on two Tasks; one waits on Robin.",
          costUsd: 0.002,
          matches: [
            {
              needingAgentId: world.bot.id,
              offeringAgentId:
                lines.find((line) => line.agent.kind === "coworker")?.agent
                  .id ?? "",
              need: "a DACH market study",
              offer: "is researching EU marketplace pricing",
              askedFor: "Could you share what you have on the DACH market?",
            },
          ],
        }),
      });
    const outcome = await run();
    expect(outcome?.status).toBe("POSTED");
    const root = await prisma.chatRoomMessage.findUniqueOrThrow({
      where: { id: outcome!.messageId! },
      select: {
        content: true,
        senderUserId: true,
        room: { select: { name: true } },
        userMentionsAsSource: { select: { userId: true } },
        replies: {
          select: {
            senderSokoBotId: true,
            content: true,
            mentionsAsSource: {
              select: { coworkerId: true, chainDepth: true },
            },
          },
        },
      },
    });
    expect(root.room.name).toBe("Stand-up");
    expect(root.senderUserId).toBeNull();
    expect(root.content).toContain('today: "EU marketplace pricing research"');
    expect(root.content).toContain(
      `@${world.robin.id}: "Competitor note on Langdock" waits for an answer`,
    );
    expect(root.content).not.toContain("salary");
    expect(root.userMentionsAsSource).toEqual([{ userId: world.robin.id }]);
    expect(root.replies).toHaveLength(1);
    expect(root.replies[0]).toMatchObject({
      senderSokoBotId: world.bot.id,
      mentionsAsSource: [{ coworkerId: world.mira.id, chainDepth: 1 }],
    });
    expect(root.replies[0]!.content).toContain("- Goal: a DACH market study");
    expect(dispatched).toHaveLength(1);

    expect(await run()).toBeNull();
  });
});
