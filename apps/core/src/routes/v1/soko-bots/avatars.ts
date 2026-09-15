import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  listSokoBotAvatarsQuerySchema,
  sokoBotAvatarSchema,
  topUpSokoBotAvatarsRequestSchema,
} from "@/schemas/soko-bot-avatar.schema";
import {
  listAvailableAvatars,
  topUpAvailableAvatars,
} from "@/services/soko-bot-avatar.service";

export function mountSokoBotAvatarRoutes(app: OpenAPIHonoWithAuth): void {
  const listAvatarsRoute = createRoute({
    method: "get",
    path: "/avatars",
    operationId: "listSokoBotAvatars",
    tags: ["Soko Bots"],
    request: { query: listSokoBotAvatarsQuerySchema },
    responses: {
      200: jsonSuccessResponse(
        z.array(sokoBotAvatarSchema),
        "Unclaimed mascot avatars to pick from",
      ),
      401: jsonErrorResponse("Unauthorized"),
    },
  });

  app.openapi(listAvatarsRoute, async (c) => {
    requireUserAuthContext(c.var.authContext);
    const { take, exclude } = c.req.valid("query");
    const excludeIds = exclude
      ? exclude
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      : [];
    const avatars = await listAvailableAvatars(take, { excludeIds });
    return ok(c, z.array(sokoBotAvatarSchema).parse(avatars));
  });

  /**
   * Generation writes rows and bills FAL, so it is a POST. As a GET it was
   * reachable by a cross-site top-level navigation, which carries the session
   * cookie under `SameSite=Lax`, and was cacheable by intermediaries.
   */
  const topUpAvatarsRoute = createRoute({
    method: "post",
    path: "/avatars/top-up",
    operationId: "topUpSokoBotAvatars",
    tags: ["Soko Bots"],
    request: {
      body: {
        // Without `required`, @hono/zod-openapi skips body validation entirely
        // when the request carries no JSON content-type, so `take` would arrive
        // undefined and Prisma would read the whole pool instead of a page.
        required: true,
        content: {
          "application/json": { schema: topUpSokoBotAvatarsRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        z.array(sokoBotAvatarSchema),
        "Unclaimed mascot avatars, after filling a short pool",
      ),
      401: jsonErrorResponse("Unauthorized"),
      // Reserving a generation slot runs in a Serializable transaction, so a
      // concurrent top-up can lose the race and be worth retrying verbatim.
      409: jsonErrorResponse("Conflict"),
      422: jsonErrorResponse("Unprocessable Entity"),
      429: jsonErrorResponse("Too Many Requests"),
    },
  });

  app.openapi(topUpAvatarsRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { take, excludeIds } = c.req.valid("json");
    const avatars = await topUpAvailableAvatars(take, {
      excludeIds,
      requestedByUserId: userId,
    });
    return ok(c, z.array(sokoBotAvatarSchema).parse(avatars));
  });
}
