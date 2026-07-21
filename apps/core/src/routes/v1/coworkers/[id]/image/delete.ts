import { createRoute } from "@hono/zod-openapi";

import { coworkerInclude, mapCoworker } from "@/helpers/coworker";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { deleteCoworkerImageIfOwned } from "@/lib/blob";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { coworkerSchema } from "@/schemas/coworker.schema";

import { requireCoworkerManagementAccess } from "../../coworker-management-access";
import { paramsSchema } from "../schema";

const route = createRoute({
  method: "delete",
  path: "/{id}/image",
  description:
    "Remove the coworker image (admin or owner). Clears coworker.image and deletes the previous owned blob when present.",
  tags: ["Coworkers"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(coworkerSchema, "Remove coworker image"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    await requireCoworkerManagementAccess(c.var.authContext, id);

    const coworker = await prisma.coworker.findFirst({
      where: {
        id,
        archivedAt: null,
      },
      select: {
        id: true,
        image: true,
      },
    });

    if (!coworker) {
      throw notFound("Coworker not found");
    }

    const previousImage = coworker.image;

    const updateResult = await prisma.coworker.updateMany({
      where: {
        id,
        archivedAt: null,
      },
      data: { image: null },
    });

    if (updateResult.count === 0) {
      throw notFound("Coworker not found");
    }

    const updated = await prisma.coworker.findFirst({
      where: { id },
      include: coworkerInclude,
    });

    if (!updated) {
      throw notFound("Coworker not found");
    }

    await deleteCoworkerImageIfOwned(previousImage, id);

    return ok(c, mapCoworker(updated));
  });
}
