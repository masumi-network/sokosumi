import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { badRequest, forbidden, notFound } from "@/helpers/error";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";

const params = z.object({
  id: usersRoutePathUserIdSchema,
  consentId: z.string().openapi({
    param: { name: "consentId", in: "path" },
    description: "OAuth consent ID",
    example: "consent_123",
  }),
});

const query = z.object({
  clientId: z
    .string()
    .min(1)
    .openapi({
      param: { name: "clientId", in: "query" },
      description: "OAuth client ID associated with the consent",
      example: "client_123",
    }),
});

const revokeOAuthConsentResponseSchema = z
  .object({
    revoked: z.literal(true),
  })
  .openapi("RevokeOAuthConsentResponse");

const route = createRoute({
  method: "delete",
  path: "/oauth/consents/{consentId}",
  description:
    "Revoke OAuth client access for the session user by deleting consent and invalidating tokens.",
  tags: ["Users"],
  request: {
    params,
    query,
  },
  responses: {
    200: jsonSuccessResponse(
      revokeOAuthConsentResponseSchema,
      "OAuth consent revoked",
      {
        data: { revoked: true },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);
    const { consentId } = c.req.valid("param");
    const { clientId } = c.req.valid("query");

    await prisma.$transaction(async (tx) => {
      const consent = await tx.oauthConsent.findUnique({
        where: { id: consentId },
      });

      if (!consent) {
        throw notFound("Consent not found");
      }

      if (consent.userId !== resolvedUserId) {
        throw forbidden("You can only revoke your own OAuth consents");
      }

      if (consent.clientId !== clientId) {
        throw badRequest("Client ID does not match the consent");
      }

      await tx.oauthConsent.delete({
        where: { id: consentId },
      });

      await tx.oauthRefreshToken.updateMany({
        where: {
          userId: resolvedUserId,
          clientId,
          revoked: null,
        },
        data: {
          revoked: new Date(),
        },
      });

      await tx.oauthAccessToken.deleteMany({
        where: {
          userId: resolvedUserId,
          clientId,
        },
      });
    });

    return ok(c, revokeOAuthConsentResponseSchema.parse({ revoked: true }));
  });
}
