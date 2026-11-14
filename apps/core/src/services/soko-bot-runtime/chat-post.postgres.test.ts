import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import prisma from "@/lib/db/prisma";
import { actionInputHash } from "@/lib/soko-bot/action-receipts";
import { SokoBotRuntimeService } from "../soko-bot-runtime.service";

vi.mock("@vercel/functions", () => ({
  attachDatabasePool: vi.fn(),
  waitUntil: vi.fn(),
}));

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const TURN_LIFETIME_MS = 60_000;
const userId = `chat-owner-${randomUUID()}`;
const workspaceId = randomUUID();
const organizationId = randomUUID();
const sokoBotId = randomUUID();
const roomId = randomUUID();
const ROOM_NAME = "Launch team";
const CONTENT =
  "The launch date is confirmed.\nPlease check the research brief.";
const service = new SokoBotRuntimeService();
const queuedResult = z.object({
  messageId: z.string(),
  roomId: z.literal(roomId),
  roomName: z.literal(ROOM_NAME),
  queuedContent: z.literal(CONTENT),
  deliveryStatus: z.literal("QUEUED"),
});

describe.runIf(enabled)(
  "post_chat committed summary against PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.create({
        data: {
          id: userId,
          name: "Chat result owner",
          email: `${userId}@fixture.invalid`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await prisma.organization.create({
        data: {
          id: organizationId,
          name: "Chat summary fixture",
          slug: organizationId,
          members: {
            create: { userId, role: "owner", seatAssignedAt: new Date() },
          },
        },
      });
      await prisma.workspace.create({
        data: { id: workspaceId, organizationId },
      });
      await prisma.sokoBot.create({
        data: { id: sokoBotId, userId, workspaceId, status: "RUNNING" },
      });
      await prisma.chatRoom.create({
        data: {
          id: roomId,
          name: ROOM_NAME,
          slug: `chat-summary-${roomId}`,
          kind: "channel",
          organizationId,
          createdByUserId: userId,
          sokoBotMembers: { create: { sokoBotId } },
          userMembers: { create: { userId } },
        },
      });
    });

    afterAll(async () => {
      await prisma.chatRoom.deleteMany({ where: { id: roomId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    });

    async function request() {
      const turn = await prisma.sokoBotTurn.create({
        data: {
          sokoBotId,
          requestedByUserId: userId,
          workspaceId,
          source: "CHAT",
          status: "RUNNING",
          clientTurnId: randomUUID(),
          userMessage: "Tell Launch team the confirmed date",
          capabilityNames: ["post_chat"],
          deadlineAt: new Date(Date.now() + TURN_LIFETIME_MS),
          leaseExpiresAt: new Date(Date.now() + TURN_LIFETIME_MS),
          contextSnapshot: {
            create: {
              generatedAt: new Date(),
              schemaVersion: 1,
              hash: "chat-result-fixture",
              packet: { memory: { version: 0 } },
              byteSize: 0,
              tokenEstimate: 0,
              counts: {},
              omissions: {},
            },
          },
        },
      });
      return {
        sessionId: `session-${turn.id}`,
        turnId: turn.id,
        capability: "post_chat" as const,
        toolCallId: randomUUID(),
        input: { roomId, content: CONTENT },
      };
    }

    it("saves the exact outbox text and authorized room label in the queued receipt", async () => {
      const call = await request();
      const result = await service.executeTool(call);
      const parsed = queuedResult.parse(result);
      const receipt = await prisma.sokoBotToolCall.findUniqueOrThrow({
        where: {
          turnId_toolCallId: {
            turnId: call.turnId,
            toolCallId: call.toolCallId,
          },
        },
        include: { effects: true },
      });
      expect(receipt.result).toEqual(result);
      expect(receipt.effects).toHaveLength(1);
      expect(receipt.effects[0]).toMatchObject({
        purpose: "CHAT_MESSAGE",
        status: "PENDING",
        payload: {
          messageId: parsed.messageId,
          roomId,
          content: parsed.queuedContent,
        },
      });
      expect(
        await prisma.chatRoomMessage.findUniqueOrThrow({
          where: { id: parsed.messageId },
        }),
      ).toMatchObject({ content: "", deletedAt: expect.any(Date) });
      expect(await service.executeTool(call)).toEqual(result);
    });

    it("does not fill an older completed receipt from a new request", async () => {
      const call = await request();
      const initial = queuedResult.parse(await service.executeTool(call));
      const legacyResult = {
        messageId: initial.messageId,
        roomId,
        deliveryStatus: "QUEUED",
      };
      await prisma.sokoBotToolCall.update({
        where: {
          turnId_toolCallId: {
            turnId: call.turnId,
            toolCallId: call.toolCallId,
          },
        },
        data: { result: legacyResult },
      });
      expect(await service.executeTool(call)).toEqual(legacyResult);
    });

    it("omits retry text when an internal publication ID already has an outbox", async () => {
      const call = await request();
      const initial = queuedResult.parse(await service.executeTool(call));
      const retry = {
        ...call,
        toolCallId: randomUUID(),
        input: {
          roomId,
          content: "Different retry text that was never queued",
        },
      };
      const authorized = await service.authorize(retry);
      await prisma.sokoBotToolCall.create({
        data: {
          turnId: call.turnId,
          toolCallId: retry.toolCallId,
          capability: "post_chat",
          inputHash: actionInputHash(retry.input),
        },
      });
      const result = await service["postChat"](authorized, {
        ...retry.input,
        toolCallId: retry.toolCallId,
        publicationId: initial.messageId,
      });
      expect(result).toMatchObject({
        messageId: initial.messageId,
        roomName: ROOM_NAME,
        deliveryStatus: "QUEUED",
      });
      expect(result).not.toHaveProperty("queuedContent");
      const effects = await prisma.sokoBotEffectOutbox.findMany({
        where: { receipt: { targetId: initial.messageId } },
      });
      expect(effects).toHaveLength(1);
      expect(effects[0].payload).toMatchObject({ content: CONTENT });
    });
  },
);
