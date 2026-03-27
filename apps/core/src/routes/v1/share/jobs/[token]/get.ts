import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { jobInclude } from "@sokosumi/database";
import { mapJobWithStatus } from "@sokosumi/database/helpers";

import { notFound } from "@/helpers/error.js";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  jobShareSchema,
  publicSharedJobResponseSchema,
} from "@/schemas/job-share.schema.js";
import { serializeJobDetails } from "@/types/job.js";

const paramsSchema = z.object({
  token: z.string().openapi({
    param: { name: "token", in: "path" },
    example: "public-share-token",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{token}",
  description: "Get a publicly shared job by share token",
  tags: ["Share"],
  security: [],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      publicSharedJobResponseSchema,
      "Retrieve a publicly shared job",
    ),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHono) {
  app.openapi(route, async (c) => {
    const { token } = c.req.valid("param");

    const share = await prisma.jobShare.findUnique({
      where: { token },
      include: {
        job: {
          include: jobInclude,
        },
      },
    });
    if (!share) {
      throw notFound("Job share not found");
    }

    return ok(
      c,
      publicSharedJobResponseSchema.parse({
        job: serializeJobDetails(mapJobWithStatus(share.job)),
        share: jobShareSchema.parse(share),
      }),
    );
  });
}
