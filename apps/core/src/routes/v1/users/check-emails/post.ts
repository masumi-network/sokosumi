import { createRoute } from "@hono/zod-openapi";
import { userRepository } from "@sokosumi/database/repositories";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  checkEmailsRequestSchema,
  checkEmailsResponseSchema,
} from "@/schemas/user.schema";

const route = createRoute({
  method: "post",
  path: "/",
  description: "Bulk check which email addresses already have user accounts.",
  tags: ["Users"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: checkEmailsRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      checkEmailsResponseSchema,
      "Existing user emails",
      {
        data: {
          existingEmails: ["jane@example.com"],
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireUserAuthContext(c.var.authContext);
    const { emails } = c.req.valid("json");

    const normalizedEmails = Array.from(
      new Set(
        emails.map((email) => email.trim().toLowerCase()).filter(Boolean),
      ),
    );

    const users = await Promise.all(
      normalizedEmails.map((email) =>
        userRepository.getUserByEmail(email, prisma),
      ),
    );

    const existingEmails = users
      .filter((user): user is NonNullable<typeof user> => !!user)
      .map((user) => user.email.toLowerCase());

    return ok(c, checkEmailsResponseSchema.parse({ existingEmails }));
  });
}
