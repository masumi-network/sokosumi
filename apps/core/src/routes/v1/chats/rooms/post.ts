import { createRoute } from "@hono/zod-openapi";

import { badRequest, conflict } from "@/helpers/error";
import { jsonContent, jsonErrorResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import {
  isDirectKeyUniqueConstraintError,
  isSlugUniqueConstraintError,
} from "@/helpers/prisma";
import { created, ok, successResponseSchema } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  type ChatRoom,
  chatRoomSchema,
  createChatRoomRequestSchema,
} from "@/schemas/chat-room.schema";

import {
  buildDirectParticipantRoomKey,
  buildDirectRoomName,
  buildUniqueRoomSlug,
  chatRoomInclude,
  mapChatRoom,
  normalizeUniqueStrings,
  requireActiveOrganizationId,
  validateChatCoworkerIds,
  validateOrganizationUserIds,
} from "./helpers";

// Named once and reused for 200 + 201 so openapi-ts sees a single $ref union
// member and emits a date responseTransformer (dual inline schemas skip it).
const chatRoomSuccessBodySchema = successResponseSchema(chatRoomSchema).openapi(
  "ChatRoomSuccessResponse",
);

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/",
    description:
      'Create a chat room in the active organization. `kind: "channel"` creates a named room; `kind: "direct"` creates or returns the direct room for the given participants.',
    tags: ["Chat Rooms"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: createChatRoomRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Direct chat room found",
        content: jsonContent(chatRoomSuccessBodySchema),
      },
      201: {
        description: "Chat room created",
        content: jsonContent(chatRoomSuccessBodySchema),
      },
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Organization not found"),
      409: jsonErrorResponse("Room already exists"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const organizationId = requireActiveOrganizationId(userContext);
    const body = c.req.valid("json");

    if (body.kind === "direct") {
      const direct = await createOrGetDirectRoom({
        organizationId,
        currentUserId: userContext.userId,
        memberUserIds: body.memberUserIds ?? [],
        coworkerIds: body.coworkerIds ?? [],
      });

      return direct.created ? created(c, direct.room) : ok(c, direct.room);
    }

    try {
      const room = await prisma.$transaction(async (tx) => {
        await resolveMemberOrganizationById({
          id: organizationId,
          userId: userContext.userId,
          tx,
        });

        const memberUserIds = await validateOrganizationUserIds(
          organizationId,
          [userContext.userId, ...(body.memberUserIds ?? [])],
          tx,
        );
        const coworkerIds = await validateChatCoworkerIds(
          body.coworkerIds ?? [],
          tx,
        );
        const slug = await buildUniqueRoomSlug(organizationId, body.name, tx);

        return tx.chatRoom.create({
          data: {
            organizationId,
            createdByUserId: userContext.userId,
            name: body.name,
            slug,
            topic: body.topic?.trim() || null,
            userMembers: {
              create: memberUserIds.map((userId) => ({ userId })),
            },
            readStates: {
              create: memberUserIds.map((userId) => ({ userId })),
            },
            coworkerMembers: {
              create: coworkerIds.map((coworkerId) => ({ coworkerId })),
            },
          },
          include: chatRoomInclude,
        });
      });

      return created(
        c,
        chatRoomSchema.parse(mapChatRoom(room, userContext.userId)),
      );
    } catch (error) {
      if (isSlugUniqueConstraintError(error)) {
        throw conflict("Room already exists");
      }
      throw error;
    }
  });
}

/**
 * Direct rooms are addressed by their participant set, so creation is
 * create-or-get: two clients opening the same conversation must land on one
 * room instead of racing into duplicates.
 */
async function createOrGetDirectRoom(params: {
  organizationId: string;
  currentUserId: string;
  memberUserIds: readonly string[];
  coworkerIds: readonly string[];
}): Promise<{ room: ChatRoom; created: boolean }> {
  const { organizationId, currentUserId } = params;
  const requestedMemberUserIds = normalizeUniqueStrings(params.memberUserIds);
  const requestedCoworkerIds = normalizeUniqueStrings(params.coworkerIds);

  if (requestedMemberUserIds.includes(currentUserId)) {
    throw badRequest("Choose another organization member");
  }

  if (
    requestedMemberUserIds.length === 0 &&
    requestedCoworkerIds.length === 0
  ) {
    throw badRequest("Choose a direct message target");
  }

  // Holds the key computed inside the transaction so the retry below can
  // reuse it; a plain `let` would be narrowed to `never` by control flow
  // analysis because the assignment happens inside the callback.
  const directKeyRef: { current: string | null } = { current: null };

  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        await resolveMemberOrganizationById({
          id: organizationId,
          userId: currentUserId,
          tx,
        });

        const memberUserIds = await validateOrganizationUserIds(
          organizationId,
          requestedMemberUserIds,
          tx,
        );
        const coworkerIds = await validateChatCoworkerIds(
          requestedCoworkerIds,
          tx,
        );
        const directKey = buildDirectParticipantRoomKey({
          currentUserId,
          memberUserIds,
          coworkerIds,
        });
        directKeyRef.current = directKey;

        // Future archive must unarchive-or-clear-directKey on create-or-get:
        // archived rows still hold @@unique([organizationId, directKey]).
        const existing = await tx.chatRoom.findFirst({
          where: {
            organizationId,
            directKey,
            archivedAt: null,
          },
          include: chatRoomInclude,
        });

        if (existing) {
          return { room: existing, created: false };
        }

        const [targetUsers, targetCoworkers] = await Promise.all([
          memberUserIds.length > 0
            ? tx.user.findMany({
                where: { id: { in: memberUserIds } },
                select: { id: true, name: true, email: true },
              })
            : Promise.resolve([]),
          coworkerIds.length > 0
            ? tx.coworker.findMany({
                where: { id: { in: coworkerIds } },
                select: { id: true, name: true },
              })
            : Promise.resolve([]),
        ]);
        const usersById = new Map(targetUsers.map((user) => [user.id, user]));
        const coworkersById = new Map(
          targetCoworkers.map((coworker) => [coworker.id, coworker]),
        );
        const directName = buildDirectRoomName([
          ...memberUserIds.map((userId) => {
            const user = usersById.get(userId);
            return user?.name || user?.email || userId;
          }),
          ...coworkerIds.map((coworkerId) => {
            return coworkersById.get(coworkerId)?.name || coworkerId;
          }),
        ]);
        const slug = await buildUniqueRoomSlug(organizationId, directName, tx);

        const room = await tx.chatRoom.create({
          data: {
            organizationId,
            createdByUserId: currentUserId,
            name: directName,
            slug,
            kind: "direct",
            directKey,
            userMembers: {
              create: [
                { userId: currentUserId },
                ...memberUserIds.map((userId) => ({ userId })),
              ],
            },
            readStates: {
              create: [
                { userId: currentUserId },
                ...memberUserIds.map((userId) => ({ userId })),
              ],
            },
            coworkerMembers: {
              create: coworkerIds.map((coworkerId) => ({ coworkerId })),
            },
          },
          include: chatRoomInclude,
        });

        return { room, created: true };
      });

      return {
        room: chatRoomSchema.parse(mapChatRoom(result.room, currentUserId)),
        created: result.created,
      };
    } catch (error) {
      // directKey race: another request won the create — return that room.
      if (isDirectKeyUniqueConstraintError(error) && directKeyRef.current) {
        const existing = await prisma.chatRoom.findFirst({
          where: {
            organizationId,
            directKey: directKeyRef.current,
            archivedAt: null,
          },
          include: chatRoomInclude,
        });

        if (existing) {
          return {
            room: chatRoomSchema.parse(mapChatRoom(existing, currentUserId)),
            created: false,
          };
        }

        throw conflict("Direct room already exists");
      }

      // Slug-only race: retry with a freshly reserved slug. Never report this
      // as a direct-room conflict — the participant set may still be free.
      if (isSlugUniqueConstraintError(error) && attempt < maxAttempts - 1) {
        continue;
      }

      if (isSlugUniqueConstraintError(error)) {
        throw conflict("Room slug already exists");
      }

      throw error;
    }
  }

  throw conflict("Room slug already exists");
}
