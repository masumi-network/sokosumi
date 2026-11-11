import { createRoute, z } from "@hono/zod-openapi";

import { badRequest, forbidden, serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  requireInteractiveUserAuthContext,
  requireUserAuthContext,
} from "@/middleware/auth";
import {
  BuzzAppLinkError,
  buzzConfig,
  buzzConnectionFor,
  enableBuzzForOrganization,
  exportBuzzSecretKey,
  saveBuzzAppAuthorization,
  startBuzzAppLink,
  unlinkBuzzApp,
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
    app: z
      .object({
        npub: z.string(),
        status: z.enum(["pending", "linked"]).openapi({
          description:
            "pending until the key joins a community with the invite Sokosumi issued for it.",
        }),
        authorized: z.boolean().openapi({
          description:
            "Whether the caller's Buzz app vouched for their Sokosumi key, so their Buzz agents answer what they write in Sokosumi.",
        }),
        agents: z
          .array(z.object({ name: z.string(), npub: z.string() }))
          .openapi({
            description:
              "Agents this key owns in Buzz, usable as Coworkers in the caller's rooms.",
          }),
      })
      .nullable()
      .openapi({
        description:
          "The caller's own Buzz app key, when they linked one instead of importing Sokosumi's.",
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

const appKeyInvitesSchema = z
  .object({
    invites: z.array(
      z.object({
        organizationName: z.string(),
        relayUrl: z.string(),
        joinUrl: z.string().openapi({
          description: "Opens the Buzz app and joins with a single-use invite.",
          example:
            "buzz://join?relay=wss%3A%2F%2Facme.chat.sokosumi.com&code=v2.…",
        }),
        inviteUrl: z.string().openapi({
          description: "The same invite as a web page, for another device.",
        }),
      }),
    ),
  })
  .openapi("BuzzAppKeyInvites");

const linkAppKey = createRoute({
  method: "post",
  path: "/app-key",
  tags: ["Buzz"],
  description:
    "Link the caller's own Buzz app key. Returns single-use invites; the key is linked once it joins a community with one. Interactive sessions only.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            publicKey: z.string().openapi({
              description: "The Buzz app's public key, npub1… or 64-char hex.",
            }),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(appKeyInvitesSchema, "Invites to open in Buzz"),
    400: jsonErrorResponse("Not a usable key"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    503: jsonErrorResponse("Buzz is not configured"),
  },
});

const unlinkAppKey = createRoute({
  method: "delete",
  path: "/app-key",
  tags: ["Buzz"],
  description:
    "Forget the caller's own Buzz app key. Interactive sessions only.",
  responses: {
    200: jsonSuccessResponse(z.object({ unlinked: z.boolean() }), "Unlinked"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    503: jsonErrorResponse("Buzz is not configured"),
  },
});

const authorizeAppKey = createRoute({
  method: "post",
  path: "/app-key/authorization",
  tags: ["Buzz"],
  description:
    "Save the proof the caller's Buzz app signed for their Sokosumi key (Settings → Security → Authorize external identity). Interactive sessions only.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            proof: z.string().openapi({
              description:
                'The NIP-OA auth tag Buzz shows, ["auth", owner, "", signature].',
            }),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(z.object({ authorized: z.boolean() }), "Saved"),
    400: jsonErrorResponse("Not a proof for this key"),
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
        : {
            available: false,
            identity: null,
            app: null,
            communities: [],
            canEnable: [],
          },
    ),
  );
});

app.openapi(exportSecretKey, async (c) => {
  const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
  if (!buzzConfig()) throw serviceUnavailable("Buzz is not configured");
  return ok(c, { nsec: await exportBuzzSecretKey(userId) });
});

app.openapi(linkAppKey, async (c) => {
  const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
  if (!buzzConfig()) throw serviceUnavailable("Buzz is not configured");
  const { publicKey } = c.req.valid("json");
  try {
    return ok(c, { invites: await startBuzzAppLink(userId, publicKey) });
  } catch (error) {
    if (error instanceof BuzzAppLinkError) throw badRequest(error.message);
    throw error;
  }
});

app.openapi(authorizeAppKey, async (c) => {
  const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
  if (!buzzConfig()) throw serviceUnavailable("Buzz is not configured");
  const { proof } = c.req.valid("json");
  try {
    await saveBuzzAppAuthorization(userId, proof);
  } catch (error) {
    if (error instanceof BuzzAppLinkError) throw badRequest(error.message);
    throw error;
  }
  return ok(c, { authorized: true });
});

app.openapi(unlinkAppKey, async (c) => {
  const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
  if (!buzzConfig()) throw serviceUnavailable("Buzz is not configured");
  await unlinkBuzzApp(userId);
  return ok(c, { unlinked: true });
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
