import { createRoute } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";

import { badRequest, conflict, forbidden } from "@/helpers/error";
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
  buildDirectParticipantRoomKey,
  buildDirectRoomName,
  buildUniqueRoomSlug,
  chatRoomInclude,
  filterOrganizationUserIds,
  findLiveDirectByParticipantKey,
  isOrganizationOwnerOrAdmin,
  mapChatRoom,
  mapChatRoomWithSidebarFlags,
  normalizeUniqueStrings,
  requireActiveOrganizationId,
  resolveWorkspaceIdForChatRoom,
  usersShareExternalChannel,
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
      'Create a chat room. `kind: "channel"` requires an active organization and a user session. `kind: "direct"` creates or returns a direct room (1:1 or multi-human group). Human 1:1 is an Org Direct when both people are Members of the active organization; otherwise a Personal Direct when they share an External channel roster. Multi-human groups still require an active organization. Coworker API keys may create-or-get an org-scoped coworker 1:1 with `{ kind: "direct", memberUserIds: [targetUserId] }` when the coworker is usable in that workspace; they cannot create channels, human Directs, groups, or personal coworker 1:1s. User-started coworker DMs may be personal (`organizationId` null) with no active org.'
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
        const slug = await buildUniqueRoomSlug(
          organizationId,
          body.name,
          userContext.userId,
          tx,
        );

        return tx.chatRoom.create({
          data: {
            organizationId,
            createdByUserId: userContext.userId,
            name: body.name,
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
        throw conflict("Room already exists");
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

async function findOrRestoreDirectByKey(
  tx: {
    chatRoom: Pick<typeof prisma.chatRoom, "findFirst" | "update">;
  },
  params: { organizationId: string | null; directKey: string },
) {
  const existing = await tx.chatRoom.findFirst({
    where: {
      organizationId: params.organizationId,
      directKey: params.directKey,
    },
    include: chatRoomInclude,
  });

  if (!existing) {
    return null;
  }

  if (!existing.archivedAt) {
    return existing;
  }

  return await tx.chatRoom.update({
    where: { id: existing.id },
    data: { archivedAt: null },
    include: chatRoomInclude,
  });
}

async function serializeDirectRoomForViewer(
  room: Parameters<typeof mapChatRoom>[0],
  viewerUserId: string | null,
  activeOrganizationId: string | null,
): Promise<ChatRoom> {
  return chatRoomSchema.parse(
    viewerUserId
      ? await mapChatRoomWithSidebarFlags(room, viewerUserId, prisma, {
          activeOrganizationId,
        })
      : mapChatRoom(room),
  );
}

/**
 * Valid direct create targets: human-direct (≥1 humans, no coworkers) or
 * coworker-1to1 (exactly one coworker, no humans). Mix / multi-coworker /
 * empty are invalid.
 */
type DirectCreateShape =
  | {
      kind: "human-direct";
      memberUserIds: string[];
      coworkerIds: [];
    }
  | {
      kind: "coworker-1to1";
      memberUserIds: [];
      coworkerIds: [string];
    };

function parseDirectCreateShape(params: {
  currentUserId: string;
  memberUserIds: readonly string[];
  coworkerIds: readonly string[];
}): DirectCreateShape {
  const memberUserIds = normalizeUniqueStrings(params.memberUserIds);
  const coworkerIds = normalizeUniqueStrings(params.coworkerIds);

  if (memberUserIds.includes(params.currentUserId)) {
    throw badRequest("Choose another organization member");
  }

  if (memberUserIds.length === 0 && coworkerIds.length === 0) {
    throw badRequest("Choose a direct message target");
  }

  if (memberUserIds.length > 0 && coworkerIds.length > 0) {
    throw badRequest("Group direct messages cannot include coworkers.");
  }

  if (coworkerIds.length > 1) {
    throw badRequest("Direct messages support one coworker only.");
  }

  if (memberUserIds.length >= 1 && coworkerIds.length === 0) {
    return {
      kind: "human-direct",
      memberUserIds,
      coworkerIds: [],
    };
  }

  if (memberUserIds.length === 0 && coworkerIds.length === 1) {
    return {
      kind: "coworker-1to1",
      memberUserIds: [],
      coworkerIds: [coworkerIds[0]],
    };
  }

  throw badRequest("Choose a direct message target");
}

/**
 * Direct rooms are addressed by their participant set, so creation is
 * create-or-get: two clients opening the same conversation must land on one
 * room instead of racing into duplicates.
 *
 * Coworker 1:1 inherits the active organization when set, else personal.
 * Human 1:1 reuses a Personal Direct if one exists, else an Org Direct when
 * both are Members of the active org, else creates a Personal Direct when
 * they share an External channel. Multi-human groups stay org-scoped.
 */
async function createOrGetDirectRoom(params: {
  organizationId: string | null;
  currentUserId: string;
  memberUserIds: readonly string[];
  coworkerIds: readonly string[];
  /** Sidebar viewer. Null skips pin/mute/unread (coworker actor has none). */
  viewerUserId?: string | null;
}): Promise<{ room: ChatRoom; created: boolean }> {
  const { currentUserId } = params;
  const viewerUserId =
    params.viewerUserId === undefined ? currentUserId : params.viewerUserId;
  const shape = parseDirectCreateShape({
    currentUserId,
    memberUserIds: params.memberUserIds,
    coworkerIds: params.coworkerIds,
  });
  const requestedMemberUserIds = shape.memberUserIds;
  const requestedCoworkerIds = shape.coworkerIds;
  const activeOrganizationId = params.organizationId;

  // Holds the key computed inside the transaction so the retry below can
  // reuse it; a plain `let` would be narrowed to `never` by control flow
  // analysis because the assignment happens inside the callback.
  const directKeyRef: { current: string | null } = { current: null };
  const createOrganizationIdRef: { current: string | null } = {
    current: activeOrganizationId,
  };

  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        if (activeOrganizationId) {
          if (shape.kind === "human-direct") {
            await resolveMemberOrganizationById({
              id: activeOrganizationId,
              userId: currentUserId,
              tx,
            });
          } else {
            // Coworker 1:1 owner is the human on the room (user actor or
            // originated target). A missing owner is a bad target, not
            // "you are not a member".
            await validateOrganizationUserIds(
              activeOrganizationId,
              [currentUserId],
              tx,
            );
          }
        }

        if (shape.kind === "coworker-1to1") {
          const workspaceId = await resolveWorkspaceIdForChatRoom({
            organizationId: activeOrganizationId,
            personalUserId: currentUserId,
            tx,
          });
          const coworkerIds = await validateChatCoworkerIds(
            requestedCoworkerIds,
            workspaceId,
            tx,
          );
          const directKey = buildDirectParticipantRoomKey({
            currentUserId,
            memberUserIds: [],
            coworkerIds,
          });
          directKeyRef.current = directKey;
          createOrganizationIdRef.current = activeOrganizationId;

          const existing = await findOrRestoreDirectByKey(tx, {
            organizationId: activeOrganizationId,
            directKey,
          });
          if (existing) {
            return { room: existing, created: false };
          }

          return createDirectRoomRecord({
            tx,
            currentUserId,
            organizationId: activeOrganizationId,
            directKey,
            memberUserIds: [],
            coworkerIds,
          });
        }

        const isGroup = requestedMemberUserIds.length > 1;
        const orgTeammateIds = activeOrganizationId
          ? await filterOrganizationUserIds(
              activeOrganizationId,
              requestedMemberUserIds,
              tx,
            )
          : [];
        const targetsAreOrgTeammates =
          activeOrganizationId != null &&
          orgTeammateIds.length === requestedMemberUserIds.length;

        if (isGroup && !activeOrganizationId) {
          throw badRequest("Switch to an organization to message a teammate.");
        }
        if (isGroup && !targetsAreOrgTeammates) {
          throw badRequest(
            "Room human members must belong to the organization",
          );
        }

        const memberUserIds = requestedMemberUserIds;
        const directKey = buildDirectParticipantRoomKey({
          currentUserId,
          memberUserIds,
          coworkerIds: [],
        });
        directKeyRef.current = directKey;

        const existing = await findLiveDirectByParticipantKey(
          tx,
          directKey,
          targetsAreOrgTeammates ? activeOrganizationId : null,
        );
        if (existing) {
          return { room: existing, created: false };
        }

        if (!targetsAreOrgTeammates) {
          const peerUserId = memberUserIds[0];
          const shareChannel = await usersShareExternalChannel(
            currentUserId,
            peerUserId,
            tx,
          );
          if (!shareChannel) {
            throw badRequest(
              "You can only message people you share an external channel with.",
            );
          }
        }

        const organizationId = targetsAreOrgTeammates
          ? activeOrganizationId
          : null;
        createOrganizationIdRef.current = organizationId;

        return createDirectRoomRecord({
          tx,
          currentUserId,
          organizationId,
          directKey,
          memberUserIds,
          coworkerIds: [],
        });
      });

      return {
        room: await serializeDirectRoomForViewer(
          result.room,
          viewerUserId,
          activeOrganizationId,
        ),
        created: result.created,
      };
    } catch (error) {
      // directKey race: another request won the create — return that room.
      if (isDirectKeyUniqueConstraintError(error) && directKeyRef.current) {
        const existing =
          shape.kind === "coworker-1to1"
            ? await findOrRestoreDirectByKey(prisma, {
                organizationId: createOrganizationIdRef.current,
                directKey: directKeyRef.current,
              })
            : await findLiveDirectByParticipantKey(
                prisma,
                directKeyRef.current,
                createOrganizationIdRef.current,
              );

        if (existing) {
          return {
            room: await serializeDirectRoomForViewer(
              existing,
              viewerUserId,
              activeOrganizationId,
            ),
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
        throw conflict("Room already exists");
      }

      throw error;
    }
  }

  throw conflict("Room already exists");
}

async function createDirectRoomRecord(params: {
  tx: Prisma.TransactionClient;
  currentUserId: string;
  organizationId: string | null;
  directKey: string;
  memberUserIds: readonly string[];
  coworkerIds: readonly string[];
}) {
  const {
    tx,
    currentUserId,
    organizationId,
    directKey,
    memberUserIds,
    coworkerIds,
  } = params;

  const [targetUsers, targetCoworkers] = await Promise.all([
    memberUserIds.length > 0
      ? tx.user.findMany({
          where: { id: { in: [...memberUserIds] } },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([]),
    coworkerIds.length > 0
      ? tx.coworker.findMany({
          where: { id: { in: [...coworkerIds] } },
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
  const slug = await buildUniqueRoomSlug(
    organizationId,
    directName,
    currentUserId,
    tx,
  );

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
}
