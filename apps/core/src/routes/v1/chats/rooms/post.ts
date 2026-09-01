import { createRoute } from "@hono/zod-openapi";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { badRequest, conflict, forbidden } from "@/helpers/error";
import { jsonContent, jsonErrorResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { isSlugUniqueConstraintError } from "@/helpers/prisma";
import { created, ok, successResponseSchema } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import {
  isCoworkerAuthContext,
  requireUserAuthContext,
} from "@/middleware/auth";
import {
  type ChatRoom,
  chatRoomSchema,
  createChatRoomRequestSchema,
} from "@/schemas/chat-room.schema";

import {
  chatRoomInclude,
  createOrGetDirectRoom,
  isOrganizationOwnerOrAdmin,
  mapChatRoomWithSidebarFlags,
  requireActiveOrganizationId,
  requireSanitizedChannelSlug,
  resolveChannelName,
  resolveWorkspaceIdForChatRoom,
  validateChatCoworkerIds,
  validateChatOrchestratorIds,
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
      'Create a chat room. `kind: "channel"` requires an active organization and a user session. `kind: "direct"` creates or returns a direct room (1:1 or multi-human group). Human 1:1 is an Org Direct when both people are Members of the active organization; otherwise a Personal Direct when they share an External channel roster. Multi-human groups still require an active organization. Coworker API keys may create-or-get an org-scoped coworker 1:1 with `{ kind: "direct", memberUserIds: [targetUserId] }` when the coworker is usable in that workspace; they cannot create channels, human Directs, groups, or personal coworker 1:1s. User-started coworker DMs may be personal (`organizationId` null) with no active org.',
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
      409: jsonErrorResponse("Conflict"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = c.var.authContext;
    const body = c.req.valid("json");

    if (isCoworkerAuthContext(authContext)) {
      const direct = await createOrGetCoworkerOriginatedDirect({
        coworkerId: authContext.coworkerId,
        organizationId: authContext.context?.organizationId ?? null,
        memberUserIds: body.kind === "direct" ? (body.memberUserIds ?? []) : [],
        coworkerIds: body.kind === "direct" ? (body.coworkerIds ?? []) : [],
        kind: body.kind,
      });

      return direct.created ? created(c, direct.room) : ok(c, direct.room);
    }

    const userContext = requireUserAuthContext(authContext);

    if (body.kind === "direct") {
      if ((body.orchestratorIds ?? []).length > 0) {
        throw badRequest(
          "Add personal assistants to a channel or via room settings",
        );
      }
      const direct = await createOrGetDirectRoom({
        // Both kinds respect activeOrganization when present.
        // Coworker 1:1 may be personal (null) with no active org.
        // Human 1:1 is personal when the pair share an External channel and
        // are not both Members of the active org; groups still need an org.
        organizationId: userContext.organizationId,
        currentUserId: userContext.userId,
        memberUserIds: body.memberUserIds ?? [],
        coworkerIds: body.coworkerIds ?? [],
      });

      return direct.created ? created(c, direct.room) : ok(c, direct.room);
    }

    const organizationId = requireActiveOrganizationId(userContext);
    const slug = requireSanitizedChannelSlug(body.slug);
    const name = resolveChannelName(body.name, slug);

    try {
      const room = await prisma.$transaction(async (tx) => {
        const { role } = await resolveMemberOrganizationById({
          id: organizationId,
          userId: userContext.userId,
          tx,
        });

        if (
          body.discoverability === "external" &&
          !isOrganizationOwnerOrAdmin(role)
        ) {
          throw forbidden(
            "Only an organization owner or admin can create external channels.",
          );
        }

        const memberUserIds = await validateOrganizationUserIds(
          organizationId,
          [userContext.userId, ...(body.memberUserIds ?? [])],
          tx,
        );
        const workspaceId = await resolveWorkspaceIdForChatRoom({
          organizationId,
          personalUserId: userContext.userId,
          tx,
        });
        const coworkerIds = await validateChatCoworkerIds(
          body.coworkerIds ?? [],
          workspaceId,
          tx,
        );
        const orchestratorIds = await validateChatOrchestratorIds(
          body.orchestratorIds ?? [],
          { workspaceId, ownerUserId: userContext.userId },
          tx,
        );

        return tx.chatRoom.create({
          data: {
            organizationId,
            createdByUserId: userContext.userId,
            name,
            slug,
            topic: body.topic?.trim() || null,
            discoverability: body.discoverability,
            userMembers: {
              create: memberUserIds.map((userId) => ({
                userId,
                access: "member",
              })),
            },
            readStates: {
              create: memberUserIds.map((userId) => ({ userId })),
            },
            coworkerMembers: {
              create: coworkerIds.map((coworkerId) => ({ coworkerId })),
            },
            orchestratorMembers: {
              create: orchestratorIds.map((orchestratorId) => ({
                orchestratorId,
              })),
            },
          },
          include: chatRoomInclude,
        });
      });

      return created(
        c,
        chatRoomSchema.parse(
          await mapChatRoomWithSidebarFlags(room, userContext.userId, prisma),
        ),
      );
    } catch (error) {
      if (isSlugUniqueConstraintError(error)) {
        throw conflict("This Channel slug is taken.", {
          kind: CORE_API_ERROR_KINDS.CHANNEL_SLUG_TAKEN,
        });
      }
      throw error;
    }
  });
}

/**
 * Coworker API keys may create-or-get an org-scoped coworker 1:1 with exactly
 * one organization member. The coworker id is the auth actor, not the body.
 * Channels, human Directs, groups, and personal coworker 1:1s stay user-only.
 */
async function createOrGetCoworkerOriginatedDirect(params: {
  coworkerId: string;
  organizationId: string | null;
  memberUserIds: readonly string[];
  coworkerIds: readonly string[];
  kind: "channel" | "direct";
}): Promise<{ room: ChatRoom; created: boolean }> {
  if (params.kind !== "direct") {
    throw forbidden("Coworker API keys cannot create channels");
  }

  if (!params.organizationId) {
    throw badRequest("Switch to an organization to message a teammate.");
  }

  if (params.coworkerIds.length > 0) {
    throw badRequest("Coworker API keys cannot include coworkerIds");
  }

  if (params.memberUserIds.length !== 1) {
    throw badRequest("Choose a direct message target");
  }

  return await createOrGetDirectRoom({
    organizationId: params.organizationId,
    currentUserId: params.memberUserIds[0]!,
    memberUserIds: [],
    coworkerIds: [params.coworkerId],
    viewerUserId: null,
  });
}
