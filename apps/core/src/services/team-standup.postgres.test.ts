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
      writeBot: async () => {
        throw new Error("no bot writes on a quiet day");
      },
    });
    expect(outcome?.status).toBe("QUIET");
    expect(
      await prisma.chatRoomMessage.count({
        where: { room: { organizationId: world.organization.id } },
      }),
    ).toBe(0);
  });

  it("posts an opener, then each agent's own message, mentions the person a Task waits on, and opens the match's hand-off under the needing bot's message once", async () => {
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
        writeBot: async (record) => ({
          text: `Nothing finished yet. Next: ${record.open.join(", ")}.`,
          source: "own",
          costUsd: 0.001,
        }),
        shorten: async (titles) => ({
          short: new Map(
            titles.map((title) => [
              title,
              title.startsWith("EU") ? "EU pricing research" : title,
            ]),
          ),
          costUsd: 0.001,
        }),
        host: async ({ records }) => ({
          costUsd: 0.002,
          matches: [
            {
              needingAgentId: world.bot.id,
              offeringAgentId:
                records.find((record) => record.agent.kind === "coworker")
                  ?.agent.id ?? "",
              need: "a DACH market study",
              offer: "is researching EU marketplace pricing",
              askedFor: "Could you share what you have on the DACH market?",
            },
          ],
        }),
      });
    await prisma.task.create({
      data: {
        name: "DACH market study",
        status: "DRAFT",
        workspaceId: world.workspaceId,
        organizationId: world.organization.id,
        ownerId: world.robin.id,
      },
    });
    const outcome = await run();
    expect(outcome?.status).toBe("POSTED");
    const room = await prisma.chatRoom.findFirstOrThrow({
      where: { organizationId: world.organization.id },
      select: {
        name: true,
        messages: {
          where: { parentMessageId: null },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            content: true,
            senderUserId: true,
            senderSokoBotId: true,
            senderCoworkerId: true,
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
        },
      },
    });
    expect(room.name).toBe("Stand-up");
    const [opener, bot, mira, ...rest] = room.messages;
    expect(rest).toHaveLength(0);
    expect(opener).toMatchObject({
      id: outcome!.messageId,
      senderUserId: null,
      senderSokoBotId: null,
      senderCoworkerId: null,
    });
    expect(opener!.content).toMatch(/^\*\*Stand-up · .+\*\*$/);
    expect(bot).toMatchObject({
      senderSokoBotId: world.bot.id,
      content: "Nothing finished yet. Next: DACH market study.",
    });
    expect(mira!.senderCoworkerId).toBe(world.mira.id);
    expect(mira!.content).toBe(
      [
        "Working on: EU pricing research.",
        `Waiting on @${world.robin.id}: Competitor note on Langdock.`,
      ].join("\n"),
    );
    expect(mira!.userMentionsAsSource).toEqual([{ userId: world.robin.id }]);
    expect(
      room.messages.some((message) => message.content.includes("salary")),
    ).toBe(false);
    expect(bot!.replies).toHaveLength(1);
    expect(bot!.replies[0]).toMatchObject({
      senderSokoBotId: world.bot.id,
      mentionsAsSource: [{ coworkerId: world.mira.id, chainDepth: 1 }],
    });
    expect(bot!.replies[0]!.content).toContain("- Goal: a DACH market study");
    expect(dispatched).toHaveLength(1);

    expect(await run()).toBeNull();
  });
});
