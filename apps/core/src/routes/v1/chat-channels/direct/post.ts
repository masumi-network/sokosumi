import { createRoute } from "@hono/zod-openapi";

import { badRequest, conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import {
  isPrismaUniqueViolation,
  isSlugUniqueConstraintError,
} from "@/helpers/prisma";
import { created, ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  chatChannelSchema,
  createDirectChatChannelRequestSchema,
} from "@/schemas/chat-channel.schema";

import {
  buildDirectChannelName,
  buildDirectParticipantChannelKey,
  buildUniqueChannelSlug,
  chatChannelInclude,
  mapChatChannel,
  normalizeUniqueStrings,
  validateChatCoworkerIds,
  validateOrganizationUserIds,
} from "../helpers";

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/direct",
    description:
      "Create or return a direct chat channel with organization members and AI coworkers.",
    tags: ["Chat Channels"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: createDirectChatChannelRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(chatChannelSchema, "Direct chat channel found"),
      201: jsonSuccessResponse(
        chatChannelSchema,
        "Direct chat channel created",
      ),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Organization not found"),
      409: jsonErrorResponse("Direct channel already exists"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const body = c.req.valid("json");
    const requestedMemberUserIds = normalizeUniqueStrings([
      ...(body.memberUserId ? [body.memberUserId] : []),
      ...(body.memberUserIds ?? []),
    ]);
    const requestedCoworkerIds = normalizeUniqueStrings([
      ...(body.coworkerId ? [body.coworkerId] : []),
      ...(body.coworkerIds ?? []),
    ]);

    if (requestedMemberUserIds.includes(userContext.userId)) {
      throw badRequest("Choose another organization member");
    }

    // Holds the key computed inside the transaction so the retry below can
    // reuse it; a plain `let` would be narrowed to `never` by control flow
    // analysis because the assignment happens inside the callback.
    const directKeyRef: { current: string | null } = { current: null };

    try {
      const result = await prisma.$transaction(async (tx) => {
        await resolveMemberOrganizationById({
          id: body.organizationId,
          userId: userContext.userId,
          tx,
        });

        if (
          requestedMemberUserIds.length === 0 &&
          requestedCoworkerIds.length === 0
        ) {
          throw badRequest("Choose a direct message target");
        }

        const memberUserIds = await validateOrganizationUserIds(
          body.organizationId,
          requestedMemberUserIds,
          tx,
        );
        const coworkerIds = await validateChatCoworkerIds(
          requestedCoworkerIds,
          tx,
        );
        const directKey = buildDirectParticipantChannelKey({
          currentUserId: userContext.userId,
          memberUserIds,
          coworkerIds,
        });
        directKeyRef.current = directKey;

        const existing = await tx.chatChannel.findFirst({
          where: {
            organizationId: body.organizationId,
            directKey,
            archivedAt: null,
          },
          include: chatChannelInclude,
        });

        if (existing) {
          return { channel: existing, created: false };
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
        const directName = buildDirectChannelName([
          ...memberUserIds.map((userId) => {
            const user = usersById.get(userId);
            return user?.name || user?.email || userId;
          }),
          ...coworkerIds.map((coworkerId) => {
            return coworkersById.get(coworkerId)?.name || coworkerId;
          }),
        ]);
        const slug = await buildUniqueChannelSlug(
          body.organizationId,
          directName,
          tx,
        );

        const channel = await tx.chatChannel.create({
          data: {
            organizationId: body.organizationId,
            createdByUserId: userContext.userId,
            name: directName,
            slug,
            kind: "direct",
            directKey,
            userMembers: {
              create: [
                { userId: userContext.userId },
                ...memberUserIds.map((userId) => ({ userId })),
              ],
            },
            readStates: {
              create: [
                { userId: userContext.userId },
                ...memberUserIds.map((userId) => ({ userId })),
              ],
            },
            coworkerMembers: {
              create: coworkerIds.map((coworkerId) => ({ coworkerId })),
            },
          },
          include: chatChannelInclude,
        });

        return { channel, created: true };
      });

      const payload = chatChannelSchema.parse(
        mapChatChannel(result.channel, userContext.userId),
      );
      return result.created ? created(c, payload) : ok(c, payload);
    } catch (error) {
      // Slug and directKey unique races both mean another request won the
      // create. Prefer returning that channel over a 409 — including when the
      // loser hits the slug constraint first (isSlugUniqueConstraintError is a
      // P2002 subset that previously short-circuited before the re-read).
      if (
        (isSlugUniqueConstraintError(error) ||
          isPrismaUniqueViolation(error)) &&
        directKeyRef.current
      ) {
        const existing = await prisma.chatChannel.findFirst({
          where: {
            organizationId: body.organizationId,
            directKey: directKeyRef.current,
            archivedAt: null,
          },
          include: chatChannelInclude,
        });

        if (existing) {
          return ok(
            c,
            chatChannelSchema.parse(
              mapChatChannel(existing, userContext.userId),
            ),
          );
        }
      }

      if (
        isSlugUniqueConstraintError(error) ||
        isPrismaUniqueViolation(error)
      ) {
        throw conflict("Direct channel already exists");
      }

      throw error;
    }
  });
}
