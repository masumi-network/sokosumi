import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { listCalendarEvents } from "./calendar";

const email = "press@paper.example";
vi.mock("@/services/soko-bot-integrations.service", async (load) => ({
  ...(await load<object>()),
  activeIntegrationsForBot: async () => [{ id: "connection" }],
  fetchCalendarEvents: async () => [
    {
      id: "event",
      title: "Review",
      startsAt: "2026-11-19T15:00:00Z",
      attendees: [`Paper <${email}>`],
      organizer: null,
    },
  ],
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

describe.skipIf(!enabled)(
  "calendar contact references follow their delivery audience",
  () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const userId = randomUUID();
    const sokoBotId = randomUUID();
    const roomId = randomUUID();
    const contactId = randomUUID();
    const turnId = randomUUID();
    const memberId = randomUUID();

    beforeAll(async () => {
      await prisma.user.create({
        data: {
          id: userId,
          name: "Member",
          email: `${userId}@example.test`,
          emailVerified: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await prisma.organization.create({
        data: {
          id: organizationId,
          name: "Calendar fixture",
          slug: organizationId,
        },
      });
      await prisma.member.create({
        data: {
          id: memberId,
          userId,
          organizationId,
          role: "member",
          createdAt: new Date(),
        },
      });
      await prisma.workspace.create({
        data: { id: workspaceId, organizationId },
      });
      await prisma.sokoBot.create({
        data: { id: sokoBotId, userId, workspaceId },
      });
      await prisma.contact.create({
        data: {
          id: contactId,
          workspaceId,
          name: "Micah (Paper)",
          channels: { create: { workspaceId, type: "EMAIL", value: email } },
        },
      });
      await prisma.chatRoom.create({
        data: {
          id: roomId,
          createdByUserId: userId,
          name: "Calendar fixture",
          kind: "direct",
          directKey: `calendar:${roomId}`,
          userMembers: { create: { userId } },
          sokoBotMembers: { create: { sokoBotId } },
        },
      });
      const message = await prisma.chatRoomMessage.create({
        data: { roomId, senderUserId: userId, content: "Who was invited?" },
      });
      const mention = await prisma.chatRoomMention.create({
        data: { messageId: message.id, sokoBotId, status: "sent" },
      });
      await prisma.sokoBotTurn.create({
        data: {
          id: turnId,
          sokoBotId,
          workspaceId,
          requestedByUserId: userId,
          source: "CHAT",
          status: "RUNNING",
          capabilityNames: ["list_calendar_events", "search_contacts"],
          deadlineAt: new Date("2026-11-20T16:00:00Z"),
          clientTurnId: turnId,
          userMessage: "Who was invited?",
          chatMentionId: mention.id,
          destinationRoomId: roomId,
        },
      });
    });
    afterAll(async () => {
      await prisma.chatRoom.deleteMany({ where: { id: roomId } });
      await prisma.sokoBotTurn.deleteMany({ where: { id: turnId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    });

    it("links a private Direct and an internal Channel but withholds the directory in an external Channel or after access is revoked", async () => {
      const read = async () =>
        (
          await listCalendarEvents(
            {
              turn: {
                id: turnId,
                sokoBotId,
                workspaceId,
                actingUserId: userId,
                source: "CHAT",
                chainDepth: 0,
              },
              grant: {
                capabilities: ["list_calendar_events", "search_contacts"],
              },
            },
            {},
          )
        ).events[0];
      const references = [
        {
          email,
          link: `/contacts?contact=${contactId}&workspace=${workspaceId}`,
        },
      ];
      expect(await read()).toMatchObject({ contactReferences: references });
      // A shared studio mailbox has a card even when it cannot identify a person.
      await prisma.contact.update({
        where: { id: contactId },
        data: { kind: "ORGANIZATION", name: "Paper" },
      });
      expect((await read())?.contactReferences).toEqual(references);
      const { chatMentionId } = await prisma.sokoBotTurn.findUniqueOrThrow({
        where: { id: turnId },
        select: { chatMentionId: true },
      });
      // The assistant page can already have a private destination, even without a mention.
      await prisma.sokoBotTurn.update({
        where: { id: turnId },
        data: { chatMentionId: null },
      });
      expect(await read()).toMatchObject({ contactReferences: references });
      await prisma.chatRoom.update({
        where: { id: roomId },
        data: {
          kind: "channel",
          slug: roomId,
          organizationId,
          directKey: null,
          discoverability: "private",
        },
      });
      expect(await read()).not.toHaveProperty("contactReferences");
      await prisma.sokoBotTurn.update({
        where: { id: turnId },
        data: { chatMentionId },
      });
      expect(await read()).toMatchObject({ contactReferences: references });
      await prisma.chatRoom.update({
        where: { id: roomId },
        data: { discoverability: "external" },
      });
      const external = await read();
      expect(external?.attendees).toEqual([`Paper <${email}>`]);
      expect(external).not.toHaveProperty("contactReferences");
      await prisma.chatRoom.update({
        where: { id: roomId },
        data: { discoverability: "private" },
      });
      await prisma.member.delete({ where: { id: memberId } });
      expect(await read()).not.toHaveProperty("contactReferences");
    });
  },
);
