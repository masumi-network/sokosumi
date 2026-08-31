import { createRoute } from "@hono/zod-openapi";

import { getAdminOrganizationBySlug } from "@/helpers/admin-organization-overview.js";
import { ensureMatchedChannelParticipant } from "@/helpers/chat-room-matched-membership.js";
import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime.js";
import { badRequest, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  ADMIN_MATCHED_CHANNEL_ORG_SNAPSHOT_MAX_MEMBERS,
  adminAddMatchedChannelFromOrganizationBodySchema,
  adminAddMatchedChannelFromOrganizationResultSchema,
  adminMatchedChannelRoomParamsSchema,
} from "@/schemas/admin.schema";

const route = createRoute({
  method: "post",
  path: "/{roomId}/participants/from-organization",
  operationId: "addAdminMatchedChannelParticipantsFromOrganization",
  description: `Snapshot current Organization Members onto a live matched channel as members (admin only). Idempotent per user. Rejects when the organization has more than ${ADMIN_MATCHED_CHANNEL_ORG_SNAPSHOT_MAX_MEMBERS} Members — add in smaller waves or per user. Returns added / alreadyMember / totalMembers counts.`,
  tags: ["Admin"],
  request: {
    params: adminMatchedChannelRoomParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: adminAddMatchedChannelFromOrganizationBodySchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      adminAddMatchedChannelFromOrganizationResultSchema,
      "Organization Members snapshotted",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { roomId } = c.req.valid("param");
    const body = c.req.valid("json");

    const organization = body.organizationId
      ? await prisma.organization.findUnique({
          where: { id: body.organizationId },
          select: { id: true },
        })
      : await getAdminOrganizationBySlug(body.organizationSlug!, prisma);

    if (!organization) {
      throw notFound("Organization not found");
    }

    const members = await prisma.member.findMany({
      where: { organizationId: organization.id },
      select: { userId: true },
    });

    if (members.length > ADMIN_MATCHED_CHANNEL_ORG_SNAPSHOT_MAX_MEMBERS) {
      throw badRequest(
        `Organization has ${members.length} Members. Snapshot is limited to ${ADMIN_MATCHED_CHANNEL_ORG_SNAPSHOT_MAX_MEMBERS} per request — add a smaller organization, or add users individually.`,
      );
    }

    let added = 0;
    let alreadyMember = 0;
    const statusMessagesToPublish: Awaited<
      ReturnType<typeof ensureMatchedChannelParticipant>
    >["statusMessages"] = [];

    await prisma.$transaction(
      async (tx) => {
        for (const member of members) {
          const { result, statusMessages } =
            await ensureMatchedChannelParticipant(tx, {
              userId: member.userId,
              roomId,
            });
          if (result.outcome === "joined") {
            added += 1;
            statusMessagesToPublish.push(...statusMessages);
          } else {
            alreadyMember += 1;
          }
        }
      },
      {
        // Default interactive timeout is 5s; 200 sequential ensure calls need more.
        maxWait: 10_000,
        timeout: 60_000,
      },
    );

    const publishResults = await Promise.allSettled(
      statusMessagesToPublish.map((message) =>
        publishChatRoomMessageRealtime(message, "create"),
      ),
    );
    for (const publishResult of publishResults) {
      if (publishResult.status === "rejected") {
        console.error(
          "Failed to publish chat membership status after org snapshot",
          publishResult.reason,
        );
      }
    }

    return ok(
      c,
      adminAddMatchedChannelFromOrganizationResultSchema.parse({
        added,
        alreadyMember,
        totalMembers: members.length,
      }),
    );
  });
}
