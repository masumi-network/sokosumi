import { createRoute } from "@hono/zod-openapi";

import { coworkerInclude, mapCoworker } from "@/helpers/coworker";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { nullableJsonInput } from "@/helpers/prisma-json";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { hasAdminRole, requireAdminAuthContext } from "@/middleware/auth";
import {
  type CoworkerMetadata,
  coworkerSchema,
} from "@/schemas/coworker.schema";
import {
  buildCoworkerMutationWhere,
  requireCoworkerManagementAccess,
} from "../coworker-management-access";

import { mergeCoworkerMetadata, normalizeCoworkerMetadata } from "../metadata";
import { patchCoworkerRequestSchema } from "../schema";
import { paramsSchema } from "./schema";

const route = createRoute({
  method: "patch",
  path: "/{id}",
  description: "Update coworker metadata",
  tags: ["Coworkers"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: patchCoworkerRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(coworkerSchema, "Update coworker"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const userAuth = await requireCoworkerManagementAccess(
      c.var.authContext,
      id,
    );
    const body = c.req.valid("json");
    const allowArchived = hasAdminRole(userAuth.role);
    const mutationWhere = buildCoworkerMutationWhere(id, allowArchived);

    if (body.priority !== undefined) {
      requireAdminAuthContext(c.var.authContext);
    }

    const coworker = await prisma.$transaction(async (tx) => {
      const existingCoworker = await tx.coworker.findFirst({
        where: mutationWhere,
        select: {
          metadata: true,
        },
      });

      if (!existingCoworker) {
        throw notFound("Coworker not found");
      }

      const metadata = nullableJsonInput(
        body.metadata === undefined
          ? undefined
          : normalizeCoworkerMetadata(
              body.metadata === null
                ? null
                : mergeCoworkerMetadata(
                    existingCoworker.metadata as CoworkerMetadata | null,
                    body.metadata,
                  ),
            ),
      );

      const updatedCount = await tx.coworker.updateMany({
        where: mutationWhere,
        data: {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.caption !== undefined && { caption: body.caption }),
          ...(body.url !== undefined && { url: body.url }),
          ...(body.baseURL !== undefined && { baseURL: body.baseURL }),
          ...(body.description !== undefined && {
            description: body.description,
          }),
          ...(body.capabilities !== undefined && {
            capabilities: body.capabilities,
          }),
          ...(body.priority !== undefined && { priority: body.priority }),
          ...(metadata !== undefined && { metadata }),
        },
      });

      if (updatedCount.count === 0) {
        throw notFound("Coworker not found");
      }

      const updatedCoworker = await tx.coworker.findFirst({
        where: mutationWhere,
        include: coworkerInclude,
      });

      if (!updatedCoworker) {
        throw notFound("Coworker not found");
      }

      return updatedCoworker;
    });

    return ok(c, mapCoworker(coworker));
  });
}
