import { createRoute, z } from "@hono/zod-openapi";

import {
  conflict,
  forbidden,
  internalServerError,
  notFound,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { noticeAcknowledgmentResponseSchema } from "@/schemas/notice.schema";

const requestParamsSchema = z.object({
  id: z.string().openapi({
    param: {
      name: "id",
      in: "path",
    },
    description: "Notice ID",
    example: "notice_123",
  }),
});

const route = createRoute({
  method: "post",
  path: "/notices/{id}/acknowledge",
  description: "Acknowledge a notice for the current user",
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
    const { authContext } = c.var;
    const { id: noticeId } = c.req.valid("param");

    if (authContext.coworkerId) {
      throw forbidden("Coworkers are not allowed to acknowledge notices");
    }

    const now = new Date();

    const acknowledgment = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: authContext.userId },
        select: { createdAt: true },
      });
      if (!user) {
        throw internalServerError("Failed to retrieve user");
      }

      const existingAcknowledgment = await tx.noticeAcknowledgment.findUnique({
        where: {
          userId_noticeId: {
            userId: authContext.userId,
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
            userId: authContext.userId,
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
            userId: authContext.userId,
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
