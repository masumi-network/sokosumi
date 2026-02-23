import { createRoute } from "@hono/zod-openapi";

import { conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { isSlugUniqueConstraintError } from "@/helpers/prisma";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { coworkerSchema } from "@/schemas/task.schema";

import { requireCoworkerAdminAuthContext } from "../admin-guard";
import { patchCoworkerRequestSchema } from "../schema";
import { paramsSchema } from "./schema";

const route = createRoute({
  method: "patch",
  path: "/{id}",
  description: "Update coworker metadata (admin only)",
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
    409: jsonErrorResponse("Conflict"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    await requireCoworkerAdminAuthContext(c.var.authContext);

    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const coworker = await prisma.$transaction(async (tx) => {
      if (body.slug !== undefined) {
        const slugOwner = await tx.coworker.findUnique({
          where: {
            slug: body.slug,
          },
          select: {
            id: true,
          },
        });

        if (slugOwner && slugOwner.id !== id) {
          throw conflict("Coworker slug already exists");
        }
      }

      try {
        const updatedCount = await tx.coworker.updateMany({
          where: {
            id,
            archivedAt: null,
          },
          data: {
            slug: body.slug,
            name: body.name,
            caption: body.caption,
            company: body.company,
            companyLogo: body.companyLogo,
            url: body.url,
            email: body.email,
            description: body.description,
            image: body.image,
          },
        });

        if (updatedCount.count === 0) {
          throw notFound("Coworker not found");
        }

        const updatedCoworker = await tx.coworker.findFirst({
          where: {
            id,
            archivedAt: null,
          },
        });

        if (!updatedCoworker) {
          throw notFound("Coworker not found");
        }

        return updatedCoworker;
      } catch (error) {
        if (isSlugUniqueConstraintError(error)) {
          throw conflict("Coworker slug already exists");
        }
        throw error;
      }
    });

    return ok(c, coworkerSchema.parse(coworker));
  });
}
