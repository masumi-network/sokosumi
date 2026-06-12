import { createRoute, z } from "@hono/zod-openapi";
import { APIError } from "better-auth/api";

import { badRequest, forbidden, unauthorized } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { auth } from "@/lib/auth";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const passwordWriteSchema = z
  .object({
    newPassword: z.string().min(1).openapi({
      description: "The new password to set for the credential account",
    }),
  })
  .openapi("PasswordWrite");

const passwordSetSchema = z
  .object({
    status: z.boolean().openapi({ example: true }),
  })
  .openapi("PasswordSet");

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/password",
    description:
      "Set a password for the session user's credential account (path `me` or the session user's own id — used by social sign-up users who have no password yet). Wraps Better Auth's server-only setPassword endpoint; fails when a credential account already exists.",
    tags: ["Users"],
    request: {
      params,
      body: {
        content: {
          "application/json": {
            schema: passwordWriteSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(passwordSetSchema, "Password set", {
        data: { status: true },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      }),
      400: jsonErrorResponse("Bad Request - e.g. password already set"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found - User not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);
    const userContext = requireUserContext(c.var.authContext);

    // setPassword acts on the session in the forwarded headers, so the route
    // is strictly self-service — admins cannot set another user's password.
    if (resolvedUserId !== userContext.userId) {
      throw forbidden("Passwords can only be set for the session user");
    }

    const { newPassword } = c.req.valid("json");

    try {
      const result = await auth.api.setPassword({
        body: { newPassword },
        headers: c.req.raw.headers,
      });

      return ok(c, passwordSetSchema.parse({ status: result.status }));
    } catch (error) {
      if (error instanceof APIError) {
        const message =
          typeof error.body?.message === "string"
            ? error.body.message
            : "Failed to set password";
        if (error.statusCode === 401) {
          throw unauthorized(message);
        }
        throw badRequest(message);
      }
      throw error;
    }
  });
}
