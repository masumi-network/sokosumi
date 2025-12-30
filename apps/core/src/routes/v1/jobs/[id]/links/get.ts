import { createRoute, z } from "@hono/zod-openapi";
import prisma from "@sokosumi/database/client";

import { requireJobAccess } from "@/helpers/access-control.js";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { linksSchema } from "@/schemas/link.schema";
import { flattenLinkJobId, linkWithJobIdInclude } from "@/types/link";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmi4gmksz000104l8wps8p7fp",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/links",
  tags: ["Jobs"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(linksSchema, "Retrieve links by job ID", {
      data: [
        {
          id: "link_123",
          createdAt: "2025-01-15T10:30:00.000Z",
          updatedAt: "2025-01-15T10:30:00.000Z",
          userId: "user_123",
          jobId: "cmi4gmksz000104l8wps8p7fp",
          url: "https://example.com/article1",
          title: "Example Article 1",
        },
        {
          id: "link_456",
          createdAt: "2025-01-15T10:31:00.000Z",
          updatedAt: "2025-01-15T10:31:00.000Z",
          userId: "user_123",
          jobId: "cmi4gmksz000104l8wps8p7fp",
          url: "https://example.com/article2",
          title: "Example Article 2",
        },
      ],
      meta: {
        timestamp: "2025-01-15T12:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");

    const links = await prisma.$transaction(async (tx) => {
      await requireJobAccess(authContext, id, tx);
      const links = await tx.link.findMany({
        where: { event: { jobId: id } },
        include: linkWithJobIdInclude,
      });
      return links.map(flattenLinkJobId);
    });

    return ok(c, linksSchema.parse(links));
  });
}
