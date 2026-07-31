import { createRoute, z } from "@hono/zod-openapi";
import { publicShareRepository } from "@sokosumi/database/repositories";

import { requireJobCollaboration } from "@/helpers/access-control.js";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "job_123",
  }),
});

const deleteJobShareResponseSchema = z.object({});

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "delete",
    path: "/{id}/share",
    description: "Delete the public share for a job",
    tags: ["Jobs"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(
        deleteJobShareResponseSchema,
        "Delete a job share",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");

    await prisma.$transaction(async (tx) => {
      await requireJobCollaboration(c.var.authContext, id, tx);

      await publicShareRepository.deleteByJobId(id, tx);
    });

    return ok(c, deleteJobShareResponseSchema.parse({}));
  });
}
