import { createRoute, z } from "@hono/zod-openapi";

import { badRequest, forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import { empty } from "@/helpers/response";
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
    description: "OAuth consent id",
    example: "consent_123",
  }),
});

const query = z.object({
  clientId: z.string().openapi({
    param: { name: "clientId", in: "query" },
    description: "OAuth client id associated with the consent",
    example: "client_abc",
  }),
});

const route = createRoute({
  method: "delete",
  path: "/oauth/consents/{consentId}",
  description:
    "Revoke OAuth client access for the session user by deleting consent and tokens.",
  tags: ["Users"],
  request: { params, query },
  responses: {
    204: {
      description: "OAuth consent revoked",
    },
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    const { consentId } = c.req.valid("param");
    const { clientId } = c.req.valid("query");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const consent = await prisma.oauthConsent.findUnique({
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

    await prisma.$transaction(async (tx) => {
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

    return empty(c);
  });
}
