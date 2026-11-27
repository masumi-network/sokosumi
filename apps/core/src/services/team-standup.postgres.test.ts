import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { botFallbackMessage } from "@/lib/team-standup/standup-text";
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
  const coworker = (who: string) =>
    prisma.coworker.create({
      data: {
        name: who,
        slug: `${who.toLowerCase()}-${suffix}`,
        capabilities: ["tasks", "chat"],
        vendorId: vendor.id,
      },
    });
  const mira = await coworker("Mira");
  const maya = await coworker("Maya");
  // On by default: nobody switched Soko on.
  const bot = await prisma.sokoBot.create({
    data: { userId: robin.id, workspaceId, name: "Soko" },
    select: { id: true },
  });
  const left = await prisma.sokoBot.create({
    data: {
      userId: hannah.id,
      workspaceId,
      name: "Hal",
      leftTeamStandupAt: new Date(),
    },
    select: { id: true },
  });
  const standup = await prisma.teamStandup.create({
    data: { organizationId: organization.id, enabled: true },
  });
  return {
    robin,
    hannah,
    organization,
    workspaceId,
    mira,
    maya,
    bot,
    left,
    standup,
  };
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
      mayPost: async () => true,
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

  it("posts an opener, then one message per bot that tells its person's Coworker work, mentions the person a Task waits on, and opens the match's hand-off under the bot's message once", async () => {
    const world = await organizationWith("Busy Co");
    const task = (input: {
      name: string;
      status: "RUNNING" | "INPUT_REQUIRED" | "COMPLETED";
      ownerId: string;
      assigneeId: string;
    }) =>
      prisma.task.create({
        data: {
          ...input,
          workspaceId: world.workspaceId,
          organizationId: world.organization.id,
        },
      });
    await task({
      name: "EU marketplace pricing research",
      status: "RUNNING",
      ownerId: world.robin.id,
      assigneeId: world.mira.id,
    });
    await task({
      name: "Competitor note on Langdock",
      status: "INPUT_REQUIRED",
      ownerId: world.robin.id,
      assigneeId: world.mira.id,
    });
    // Hannah took her bot out: Maya's work for her goes in the opener.
    await task({
      name: "Content batch",
      status: "COMPLETED",
      ownerId: world.hannah.id,
      assigneeId: world.maya.id,
    });
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
        mayPost: async () => true,
        dispatch: async (mentionId) => {
          dispatched.push(mentionId);
        },
        writeBot: async (record) => ({
          text: botFallbackMessage(record),
          source: "record",
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
        host: async ({ coworkers }) => ({
          costUsd: 0.002,
          matches: [
            {
              needingAgentId: world.bot.id,
              offeringAgentId: coworkers?.[0]?.id ?? "",
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
        coworkerMembers: { select: { coworkerId: true } },
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
                  select: {
                    coworkerId: true,
                    chainDepth: true,
                    network: true,
                    preprodGeneration: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(room.name).toBe("Stand-up");
    const [opener, bot, ...rest] = room.messages;
    expect(rest).toHaveLength(0);
    expect(opener).toMatchObject({
      id: outcome!.messageId,
      senderUserId: null,
      senderSokoBotId: null,
      senderCoworkerId: null,
    });
    expect(opener!.content).toMatch(
      /^\*\*Stand-up · .+\*\*\nAlso from Coworkers: Maya finished Content batch\.$/,
    );
    expect(bot!.senderSokoBotId).toBe(world.bot.id);
    expect(bot!.content).toBe(
      [
        "Open on Robin Keller's list, nobody has it yet: DACH market study.",
        "Mira is on EU pricing research.",
        `Mira waits on @${world.robin.id}: Competitor note on Langdock.`,
      ].join("\n"),
    );
    expect(bot!.userMentionsAsSource).toEqual([{ userId: world.robin.id }]);
    expect(
      room.messages.some((message) => message.content.includes("salary")),
    ).toBe(false);
    expect(room.coworkerMembers).toEqual([{ coworkerId: world.mira.id }]);
    expect(bot!.replies).toHaveLength(1);
    expect(bot!.replies[0]).toMatchObject({
      senderSokoBotId: world.bot.id,
      // A stand-up is unattended: its hand-off is Mainnet by name.
      mentionsAsSource: [
        {
          coworkerId: world.mira.id,
          chainDepth: 1,
          network: "mainnet",
          preprodGeneration: null,
        },
      ],
    });
    expect(bot!.replies[0]!.content).toContain("- Goal: a DACH market study");
    expect(dispatched).toHaveLength(1);

    expect(await run()).toBeNull();
  });
});
