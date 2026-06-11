import { createRoute, z } from "@hono/zod-openapi";

import { badRequest, forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
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
  clientId: z.string().openapi({
    param: { name: "clientId", in: "query" },
    description:
      "OAuth client ID the consent was granted to; must match the consent",
    example: "client_123",
  }),
});

const revokeOauthConsentResponseSchema = z.object({});

const route = createRoute({
  method: "delete",
  path: "/oauth-consents/{consentId}",
  description:
    "Revoke OAuth client access for a user (path `me` or a user id when the caller may access that user's data): deletes the consent, revokes the client's refresh tokens, and deletes its access tokens.",
  tags: ["Users"],
  request: {
    params,
    query,
  },
  responses: {
    200: jsonSuccessResponse(
      revokeOauthConsentResponseSchema,
      "OAuth client access revoked",
    ),
    400: jsonErrorResponse("Bad Request - Client ID does not match consent"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found - Consent not found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    const { consentId } = c.req.valid("param");
    const { clientId } = c.req.valid("query");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

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

      // 1. Delete the consent
      await tx.oauthConsent.delete({
        where: { id: consentId },
      });

      // 2. Revoke all refresh tokens for this client/user
      await tx.oauthRefreshToken.updateMany({
        where: {
          userId: resolvedUserId,
          clientId,
          revoked: null, // Only revoke tokens that aren't already revoked
        },
        data: {
          revoked: new Date(),
        },
      });

      // 3. Delete all access tokens for this client/user
      await tx.oauthAccessToken.deleteMany({
        where: {
          userId: resolvedUserId,
          clientId,
        },
      });
    });

    return ok(c, revokeOauthConsentResponseSchema.parse({}));
  });
}
