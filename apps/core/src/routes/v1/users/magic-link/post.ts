import { createRoute, z } from "@hono/zod-openapi";

import { getEnv } from "@/config/env";
import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { auth } from "@/lib/auth";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireCoworkerAuthContext } from "@/middleware/auth";

const requestSchema = z.object({
  email: z.email().openapi({
    description: "Email address to send the magic link to",
    example: "new.user@example.com",
  }),
  name: z.string().trim().min(1).optional().openapi({
    description: "Optional display name for first-time signup",
    example: "New User",
  }),
});

const responseSchema = z.object({
  status: z.boolean().openapi({
    description: "Whether the magic link request was accepted",
    example: true,
  }),
});

const route = createRoute({
  method: "post",
  path: "/",
  tags: ["Users"],
  description: "Send a new-user magic link invite (coworker only)",
  request: {
    body: {
      content: {
        "application/json": {
          schema: requestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      responseSchema,
      "Magic link invite sent",
      {
        data: {
          status: true,
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    409: jsonErrorResponse("Conflict"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

function getWebAppRootUrl(): string {
  return new URL("/", getEnv().BETTER_AUTH_TRUSTED_ORIGIN).toString();
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireCoworkerAuthContext(c.var.authContext);

    const { email, name } = c.req.valid("json");
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      throw conflict("User is already registered");
    }

    const callbackURL = getWebAppRootUrl();
    const body = {
      email,
      callbackURL,
      newUserCallbackURL: callbackURL,
      ...(name ? { name } : {}),
    };

    const result = await auth.api.signInMagicLink({
      body,
      headers: c.req.raw.headers,
    });

    return ok(c, {
      status: result.status,
    });
  });
}
