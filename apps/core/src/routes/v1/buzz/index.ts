import { createRoute, z } from "@hono/zod-openapi";

import { forbidden, serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  requireInteractiveUserAuthContext,
  requireUserAuthContext,
} from "@/middleware/auth";
import {
  buzzConfig,
  buzzConnectionFor,
  enableBuzzForOrganization,
  exportBuzzSecretKey,
} from "@/services/buzz-bridge.service";

/**
 * Buzz: chat from a Buzz client in the same rooms as in Sokosumi. A person
 * signs in to Buzz with the Nostr key Sokosumi keeps for them.
 */

const connectionSchema = z
  .object({
    available: z.boolean().openapi({
      description: "Whether this Sokosumi can put chats on Buzz at all.",
    }),
    identity: z
      .object({
        pubkey: z.string().openapi({ description: "Hex public key." }),
        npub: z.string(),
      })
      .nullable()
      .openapi({
        description:
          "The caller's Buzz identity; null until one of their organizations is on Buzz.",
      }),
    canEnable: z
      .array(
        z.object({ organizationId: z.string(), organizationName: z.string() }),
      )
      .openapi({
        description:
          "Organizations the caller owns or administers that are not on Buzz yet.",
      }),
    communities: z.array(
      z.object({
        organizationId: z.string(),
        organizationName: z.string(),
        relayUrl: z.string().openapi({
          description: "The address to add in a Buzz client.",
          example: "wss://acme.chat.sokosumi.com",
        }),
      }),
    ),
  })
  .openapi("BuzzConnection");

const getConnection = createRoute({
  method: "get",
  path: "/connection",
  tags: ["Buzz"],
  description:
    "The caller's Buzz identity and the communities (one per organization on Buzz) they can sign in to from a Buzz client.",
  responses: {
    200: jsonSuccessResponse(connectionSchema, "Buzz connection"),
    401: jsonErrorResponse("Unauthorized"),
  },
});

const secretKeySchema = z
  .object({
    nsec: z.string().openapi({
      description:
        "The caller's Nostr secret key, to import into a Buzz client. Anyone holding it can write as the caller.",
    }),
  })
  .openapi("BuzzSecretKey");

const exportSecretKey = createRoute({
  method: "post",
  path: "/connection/secret-key",
  tags: ["Buzz"],
  description:
    "Reveal the caller's Buzz secret key to sign in to a Buzz client. Interactive sessions only.",
  responses: {
    200: jsonSuccessResponse(secretKeySchema, "Secret key"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    503: jsonErrorResponse("Buzz is not configured"),
  },
});

const communitySchema = z
  .object({ organizationId: z.string(), relayUrl: z.string() })
  .openapi("BuzzCommunity");

const enableOrganization = createRoute({
  method: "post",
  path: "/organizations/{organizationId}",
  tags: ["Buzz"],
  description:
    "Put an organization's chats on Buzz. Owners and admins only. Its rooms become Buzz channels within a minute.",
  request: {
    params: z.object({ organizationId: z.string() }),
  },
  responses: {
    200: jsonSuccessResponse(communitySchema, "Organization is on Buzz"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    503: jsonErrorResponse("Buzz is not configured"),
  },
});

const app = new OpenAPIHonoWithAuth();

app.openapi(getConnection, async (c) => {
  const { userId } = requireUserAuthContext(c.var.authContext);
  const connection = await buzzConnectionFor(userId);
  return ok(
    c,
    connectionSchema.parse(
      connection
        ? { available: true, ...connection }
        : { available: false, identity: null, communities: [], canEnable: [] },
    ),
  );
});

app.openapi(exportSecretKey, async (c) => {
  const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
  if (!buzzConfig()) throw serviceUnavailable("Buzz is not configured");
  return ok(c, { nsec: await exportBuzzSecretKey(userId) });
});

app.openapi(enableOrganization, async (c) => {
  const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
  const { organizationId } = c.req.valid("param");
  if (!buzzConfig()) throw serviceUnavailable("Buzz is not configured");
  const member = await prisma.member.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { role: true },
  });
  if (member?.role !== "owner" && member?.role !== "admin") {
    throw forbidden("Only owners and admins can put an organization on Buzz");
  }
  const community = await enableBuzzForOrganization(organizationId);
  return ok(c, {
    organizationId: community.organizationId,
    relayUrl: community.relayUrl,
  });
});

export default app;
