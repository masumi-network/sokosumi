import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAgentAuthContext } from "@/middleware/auth";

const querySchema = z.object({
  email: z.email().openapi({
    param: { name: "email", in: "query" },
    description: "Email address to check",
    example: "user@example.com",
  }),
});

const responseSchema = z.object({
  registered: z.boolean().openapi({
    description: "Whether the user is registered",
    example: true,
  }),
  emailVerified: z.boolean().optional().openapi({
    description: "Whether the email is verified",
    example: true,
  }),
});

const route = createRoute({
  method: "get",
  path: "/",
  tags: ["Users"],
  description: "User registered and email verified status (agent only)",
  request: {
    query: querySchema,
  },
  responses: {
    200: jsonSuccessResponse(
      responseSchema,
      "User registered and email verified status",
      {
        data: {
          registered: true,
          emailVerified: true,
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse("Bad Request - Invalid email format"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireAgentAuthContext(c.var.authContext);
    const { email } = c.req.valid("query");

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        emailVerified: true,
      },
    });

    if (!user) {
      return ok(c, {
        registered: false,
      });
    }

    return ok(c, {
      registered: true,
      emailVerified: user.emailVerified,
    });
  });
}
