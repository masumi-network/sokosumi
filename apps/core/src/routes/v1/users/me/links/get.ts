import { createRoute } from "@hono/zod-openapi";
import prisma from "@sokosumi/database/client";
import type { Context } from "hono";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { linksSchema } from "@/schemas/link.schema";
import { flattenLinkJobId, linkWithJobIdInclude } from "@/types/link";

const route = createRoute({
  method: "get",
  path: "/me/links",
  tags: ["Users"],
  responses: {
    200: jsonSuccessResponse(linksSchema, "Retrieve links by current user", {
      data: [
        {
          id: "link_123",
          createdAt: "2025-01-15T10:30:00.000Z",
          updatedAt: "2025-01-15T10:30:00.000Z",
          userId: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj",
          jobId: "cmi4gmksz000104l8wps8p7fp",
          url: "https://example.com/article1",
          title: "Example Article 1",
        },
        {
          id: "link_456",
          createdAt: "2025-01-15T11:00:00.000Z",
          updatedAt: "2025-01-15T11:00:00.000Z",
          userId: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj",
          jobId: "cmi4gmksz000104l8wps8p8fp",
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
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c: Context) => {
    const { authContext } = c.var;

    const links = await prisma.$transaction(async (tx) => {
      const links = await tx.link.findMany({
        where: { userId: authContext.userId },
        include: linkWithJobIdInclude,
      });
      return links.map(flattenLinkJobId);
    });

    return ok(c, linksSchema.parse(links));
  });
}
