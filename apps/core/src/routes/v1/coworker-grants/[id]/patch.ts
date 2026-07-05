import { createRoute, z } from "@hono/zod-openapi";
import { CoworkerGrantStatus } from "@sokosumi/database";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  coworkerGrantSchema,
  resolveCoworkerGrantRequestSchema,
} from "@/schemas/coworker-grant.schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "grant_123",
  }),
});

const route = createRoute({
  method: "patch",
  path: "/{id}",
  description:
    "Resolve a coworker access grant: approve (GRANTED), turn down (DENIED), or withdraw earlier consent (REVOKED). Idempotent.",
  tags: ["Coworker Grants"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": { schema: resolveCoworkerGrantRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(coworkerGrantSchema, "Resolve coworker grant"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    // Session-only on purpose: a delegated coworker must never resolve its
    // own access request (see requireUserAuthContext docs).
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const { status } = c.req.valid("json");

    const existing = await prisma.coworkerGrant.findFirst({
      where: { id, userId },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw notFound("Grant not found");
    }

    // Resolving a TASK_COMMENT grant settles any comments held under it:
    // approval releases them into the thread (original timestamps intact),
    // denial/revocation discards them — the user said no to the content.
    if (existing.status !== status) {
      if (status === CoworkerGrantStatus.GRANTED) {
        await prisma.taskEvent.updateMany({
          where: { heldByGrantId: id },
          data: { heldByGrantId: null },
        });
      } else {
        await prisma.taskEvent.deleteMany({
          where: { heldByGrantId: id },
        });
      }
    }

    const grant =
      existing.status === status
        ? await prisma.coworkerGrant.findUniqueOrThrow({
            where: { id },
            include: {
              coworker: {
                select: { id: true, slug: true, name: true, image: true },
              },
            },
          })
        : await prisma.coworkerGrant.update({
            where: { id },
            data: {
              status: status as CoworkerGrantStatus,
              resolvedAt: new Date(),
            },
            include: {
              coworker: {
                select: { id: true, slug: true, name: true, image: true },
              },
            },
          });

    return ok(
      c,
      coworkerGrantSchema.parse({
        id: grant.id,
        scope: grant.scope,
        status: grant.status,
        createdAt: grant.createdAt,
        resolvedAt: grant.resolvedAt,
        coworker: grant.coworker,
      }),
    );
  });
}
