import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import { sokoBotConversation } from "./soko-bot-conversation.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

describe.skipIf(!enabled)("Soko Bot conversation", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lists each step, who asked whom, what came back, with model, cost and time", async () => {
    const suffix = randomUUID().slice(0, 8);
    const user = (name: string) =>
      prisma.user.create({
        data: {
          name,
          email: `${name.split(" ")[0]!.toLowerCase()}.${suffix}@conversation.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        select: { id: true },
      });
    const robin = await user("Robin Keller");
    const hannah = await user("Hannah Weber");
    const organization = await prisma.organization.create({
      data: {
        name: "Conversation Co",
        slug: `conversation-${suffix}`,
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
    const bot = (userId: string, name: string) =>
      prisma.sokoBot.create({
        data: { userId, workspaceId, name },
        select: { id: true },
      });
    const soko = await bot(robin.id, "Soko");
    const juno = await bot(hannah.id, "Juno");
    const vendor = await prisma.vendor.create({
      data: { name: "Conversation", slug: `conversation-${suffix}` },
    });
    const mira = await prisma.coworker.create({
      data: { name: "Mira", slug: `mira-${suffix}`, vendorId: vendor.id },
    });
    const room = await prisma.chatRoom.create({
      data: {
        organizationId: organization.id,
        name: "Ask Mira",
        slug: `ask-mira-${suffix}`,
        createdByUserId: robin.id,
        userMembers: { create: [{ userId: robin.id }] },
        sokoBotMembers: {
          create: [{ sokoBotId: soko.id }, { sokoBotId: juno.id }],
        },
        coworkerMembers: { create: [{ coworkerId: mira.id }] },
      },
      select: { id: true },
    });
    const at = (seconds: number) =>
      new Date(Date.UTC(2020, 0, 6, 9, 0, seconds));
    const turn = (data: {
      parentTurnId?: string;
      userMessage: string;
      seconds: number;
      costUsdMicros: bigint;
      durationMs: number;
    }) =>
      prisma.sokoBotTurn.create({
        data: {
          sokoBotId: soko.id,
          workspaceId,
          requestedByUserId: robin.id,
          source: "CHAT",
          capabilityNames: [],
          clientTurnId: `lab:conversation:${randomUUID()}`,
          userMessage: data.userMessage,
          deadlineAt: new Date(Date.now() + 3_600_000),
          status: "COMPLETED",
          modelId: "openai/gpt-6-luna",
          costUsdMicros: data.costUsdMicros,
          durationMs: data.durationMs,
          createdAt: at(data.seconds),
          ...(data.parentTurnId
            ? {
                parentTurnId: data.parentTurnId,
                backgroundTitle: "Follow-up: tell Robin",
              }
            : {}),
        },
        select: { id: true },
      });
    const asked = await turn({
      userMessage: "Ask Mira and Juno about Langdock.",
      seconds: 0,
      costUsdMicros: 9_000n,
      durationMs: 20_000,
    });
    const question = await prisma.chatRoomMessage.create({
      data: {
        roomId: room.id,
        senderSokoBotId: soko.id,
        content: "@Mira @Juno What does Langdock cost?",
        createdAt: at(5),
      },
    });
    await prisma.sokoBotToolCall.create({
      data: {
        turnId: asked.id,
        toolCallId: "call-1",
        capability: "send_message",
        inputHash: "x",
        status: "COMPLETED",
        result: {
          messageId: question.id,
          roomId: room.id,
          to: "Mira (Coworker)",
        },
      },
    });
    await prisma.chatRoomMessage.create({
      data: {
        roomId: room.id,
        senderCoworkerId: mira.id,
        content: "€25 per seat.",
        createdAt: at(15),
      },
    });
    const junoReply = await prisma.chatRoomMessage.create({
      data: {
        roomId: room.id,
        senderSokoBotId: juno.id,
        content: "Hannah has €25 in her notes too.",
        createdAt: at(25),
      },
    });
    await prisma.sokoBotTurn.create({
      data: {
        sokoBotId: juno.id,
        workspaceId,
        requestedByUserId: hannah.id,
        source: "CHAT",
        capabilityNames: [],
        clientTurnId: `lab:conversation:${randomUUID()}`,
        userMessage: "@Juno What does Langdock cost?",
        deadlineAt: new Date(Date.now() + 3_600_000),
        status: "COMPLETED",
        chainDepth: 1,
        modelId: "openai/gpt-6-luna",
        costUsdMicros: 4_000n,
        durationMs: 9_000,
        chatResponseMessageId: junoReply.id,
        createdAt: at(20),
      },
    });
    const followUp = await turn({
      parentTurnId: asked.id,
      userMessage: "Follow-up",
      seconds: 40,
      costUsdMicros: 3_000n,
      durationMs: 6_000,
    });

    const conversation = await sokoBotConversation(followUp.id, {
      ownerUserId: robin.id,
    });
    expect(conversation?.turnId).toBe(asked.id);
    expect(
      conversation?.steps.map((step) => [
        step.kind,
        "by" in step ? step.by : step.title,
      ]),
    ).toEqual([
      ["turn", "Ask Mira and Juno about Langdock."],
      ["asked", "Soko"],
      ["answered", "Mira"],
      ["answered", "Juno"],
      ["turn", "Follow-up: tell Robin"],
    ]);
    expect(conversation?.steps[3]).toMatchObject({
      byKind: "assistant",
      model: "openai/gpt-6-luna",
      costUsd: 0.004,
      durationMs: 9_000,
    });
    expect(conversation?.totals).toEqual({
      costUsd: 0.016,
      durationMs: 35_000,
      models: ["openai/gpt-6-luna"],
    });

    expect(
      await sokoBotConversation(followUp.id, { ownerUserId: hannah.id }),
    ).toBeNull();
  });
});
