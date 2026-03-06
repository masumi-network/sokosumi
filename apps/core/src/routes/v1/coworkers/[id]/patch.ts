import { createRoute } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { coworkerSchema } from "@/schemas/task.schema";

import { requireCoworkerManagementAccess } from "../admin-guard";
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
    await requireCoworkerManagementAccess(c.var.authContext, id);
    const body = c.req.valid("json");

    const coworker = await prisma.$transaction(async (tx) => {
      const updatedCount = await tx.coworker.updateMany({
        where: {
          id,
          archivedAt: null,
        },
        data: {
          name: body.name,
          caption: body.caption,
          company: body.company,
          companyLogo: body.companyLogo,
          url: body.url,
          baseURL: body.baseURL,
          email: body.email,
          description: body.description,
          capabilities: body.capabilities,
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
    });

    return ok(c, coworkerSchema.parse(coworker));
  });
}
