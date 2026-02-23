import { createRoute } from "@hono/zod-openapi";

import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { isSlugUniqueConstraintError } from "@/helpers/prisma";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { coworkerSchema } from "@/schemas/task.schema";

import { requireCoworkerAdminAuthContext } from "./admin-guard";
import { createCoworkerRequestSchema } from "./schema";

const route = createRoute({
  method: "post",
  path: "/",
  description: "Create coworker (admin only)",
  tags: ["Coworkers"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createCoworkerRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(coworkerSchema, "Create coworker", {
      data: {
        id: "cow_123",
        slug: "ops-agent",
        name: "Ops Agent",
        caption: "Senior Campaign Partner",
        company: "Serviceplan",
        companyLogo: "https://example.com/company-logo",
        url: "https://example.com",
        email: "ops@example.com",
        description: "Ops helper",
        image: "https://example.com/logo",
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      meta: {
        timestamp: "2025-01-01T00:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    409: jsonErrorResponse("Conflict"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = await requireCoworkerAdminAuthContext(
      c.var.authContext,
    );
    const body = c.req.valid("json");

    const coworker = await prisma.$transaction(async (tx) => {
      const existingCoworker = await tx.coworker.findUnique({
        where: {
          slug: body.slug,
        },
        select: {
          id: true,
        },
      });

      if (existingCoworker) {
        throw conflict("Coworker slug already exists");
      }

      try {
        return await tx.coworker.create({
          data: {
            userId: authContext.userId,
            slug: body.slug,
            name: body.name,
            caption: body.caption ?? null,
            company: body.company ?? null,
            companyLogo: body.companyLogo ?? null,
            url: body.url ?? null,
            email: body.email ?? null,
            description: body.description ?? null,
            image: body.image ?? null,
          },
        });
      } catch (error) {
        if (isSlugUniqueConstraintError(error)) {
          throw conflict("Coworker slug already exists");
        }
        throw error;
      }
    });

    return created(c, coworkerSchema.parse(coworker));
  });
}
