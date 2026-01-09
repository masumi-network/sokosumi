import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import prisma from "@sokosumi/database/client";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";

const querySchema = z.object({
  email: z.email().openapi({
    param: { name: "email", in: "query" },
    description: "Email address to check",
    example: "user@example.com",
  }),
});

const responseSchema = z.object({
  exists: z.boolean().openapi({
    description: "Whether the user exists",
    example: true,
  }),
  emailVerified: z.boolean().optional().openapi({
    description: "Whether the email is verified",
    example: true,
  }),
});

const route = createRoute({
  method: "get",
  path: "/exists",
  tags: ["Users"],
  security: [],
  request: {
    query: querySchema,
  },
  responses: {
    200: jsonSuccessResponse(
      responseSchema,
      "User exists. Returns email verification status",
      {
        data: {
          emailVerified: true,
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse("Bad Request - Invalid email format"),
  },
});

export default function mount(app: OpenAPIHono) {
  app.openapi(route, async (c) => {
    const { email } = c.req.valid("query");

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        emailVerified: true,
      },
    });

    if (!user) {
      return ok(c, {
        exists: false,
      });
    }

    return ok(c, {
      exists: true,
      emailVerified: user.emailVerified,
    });
  });
}
