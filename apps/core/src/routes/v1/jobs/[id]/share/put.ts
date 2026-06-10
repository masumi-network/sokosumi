import { createRoute, z } from "@hono/zod-openapi";
import { publicShareRepository } from "@sokosumi/database/repositories";

import { requireJobCollaboration } from "@/helpers/access-control.js";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import {
  jobShareSchema,
  putJobShareRequestSchema,
} from "@/schemas/public-share.schema.js";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "job_123",
  }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "put",
    path: "/{id}/share",
    description: "Create or update the public share for a job",
    tags: ["Jobs"],
    request: {
      params: paramsSchema,
      body: {
        content: {
          "application/json": {
            schema: putJobShareRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(jobShareSchema, "Create or update a job share"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const { allowSearchIndexing } = c.req.valid("json");

    const share = await prisma.$transaction(async (tx) => {
      await requireJobCollaboration(c.var.authContext, id, tx);

      return await publicShareRepository.upsertForJob(
        id,
        allowSearchIndexing,
        tx,
      );
    });

    return ok(c, jobShareSchema.parse(share));
  });
}
