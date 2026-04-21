import { createRoute, z } from "@hono/zod-openapi";

import { conflict, internalServerError, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  resolveUsersPathUserId,
  usersRoutePathUserIdSchema,
} from "@/routes/v1/users/user-path-access";
import { noticeAcknowledgmentResponseSchema } from "@/schemas/notice.schema";

const requestParamsSchema = z.object({
  id: usersRoutePathUserIdSchema,
  noticeId: z.string().openapi({
    param: { name: "noticeId", in: "path" },
    description: "Notice ID",
    example: "notice_123",
  }),
});

const route = createRoute({
  method: "post",
  path: "/notices/{noticeId}/acknowledge",
  description:
    "Acknowledge a notice: first path segment is `me` or a user id; second is the notice id.",
  tags: ["Users"],
  request: {
    params: requestParamsSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      noticeAcknowledgmentResponseSchema,
      "Notice acknowledged successfully",
      {
        data: {
          noticeId: "notice_123",
          acknowledgedAt: "2026-02-20T09:05:00.000Z",
          alreadyAcknowledged: false,
        },
        meta: {
          timestamp: "2026-02-20T09:05:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id: pathUser, noticeId } = c.req.valid("param");
    const { targetUserId } = resolveUsersPathUserId(
      c.var.authContext,
      pathUser,
    );

    const now = new Date();

    const acknowledgment = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: targetUserId },
        select: { createdAt: true },
      });
      if (!user) {
        throw internalServerError("Failed to retrieve user");
      }

      const existingAcknowledgment = await tx.noticeAcknowledgment.findUnique({
        where: {
          userId_noticeId: {
            userId: targetUserId,
            noticeId,
          },
        },
        select: {
          acknowledgedAt: true,
        },
      });

      if (existingAcknowledgment) {
        return {
          noticeId,
          acknowledgedAt: existingAcknowledgment.acknowledgedAt,
          alreadyAcknowledged: true,
        };
      }

      const applicableNotice = await tx.notice.findFirst({
        where: {
          id: noticeId,
          isActive: true,
          effectiveAt: {
            lte: now,
            gt: user.createdAt,
          },
        },
        select: { id: true },
      });

      if (!applicableNotice) {
        const noticeExists = await tx.notice.findUnique({
          where: { id: noticeId },
          select: { id: true },
        });
        if (!noticeExists) {
          throw notFound("Notice not found");
        }
        throw conflict("Notice is not currently applicable");
      }

      const createResult = await tx.noticeAcknowledgment.createMany({
        data: [
          {
            userId: targetUserId,
            noticeId,
            acknowledgedAt: now,
          },
        ],
        skipDuplicates: true,
      });

      if (createResult.count === 1) {
        return {
          noticeId,
          acknowledgedAt: now,
          alreadyAcknowledged: false,
        };
      }

      const acknowledgedAfterRace = await tx.noticeAcknowledgment.findUnique({
        where: {
          userId_noticeId: {
            userId: targetUserId,
            noticeId,
          },
        },
        select: {
          acknowledgedAt: true,
        },
      });

      if (!acknowledgedAfterRace) {
        throw internalServerError("Failed to acknowledge notice");
      }

      return {
        noticeId,
        acknowledgedAt: acknowledgedAfterRace.acknowledgedAt,
        alreadyAcknowledged: true,
      };
    });

    return ok(c, noticeAcknowledgmentResponseSchema.parse(acknowledgment));
  });
}
