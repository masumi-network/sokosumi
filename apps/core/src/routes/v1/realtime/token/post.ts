import { createRoute } from "@hono/zod-openapi";
import { serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  getSubscribeRestClient,
  isSubscribeClientConfigured,
} from "@/lib/ably/client";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { ablyTokenRequestSchema } from "@/schemas/realtime.schema";

/**
 * Token lifetime. Ably's own default is 60 minutes; we set it explicitly so
 * the value is visible here rather than inherited.
 *
 * Not from `TIME` in config/constants — those values are seconds, and Ably's
 * `ttl` is milliseconds.
 */
const TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * Subscribe-only capability for the four per-user channels published by
 * `lib/ably/publish.ts`.
 *
 * The wildcard segment matters: `makeAgentJobsChannelName` embeds an agent id
 * (`agent_jobs:agent_<agentId>:user_<userId>`), so a concrete name cannot be
 * enumerated up front. The other three helpers emit `all` in that position,
 * which `*` also covers.
 *
 * Keep in sync with `packages/utils/src/ably-channel.ts` — a rename there
 * would silently stop matching these patterns, and subscribers would fail with
 * a capability error rather than anything more obvious.
 */
function subscribeCapability(userId: string): Record<string, ["subscribe"]> {
  return {
    [`agent_jobs:*:user_${userId}`]: ["subscribe"],
    [`tasks:*:user_${userId}`]: ["subscribe"],
    [`notifications:*:user_${userId}`]: ["subscribe"],
    [`chat_rooms:*:user_${userId}`]: ["subscribe"],
  };
}

const route = createRoute({
  method: "post",
  path: "/token",
  description:
    "Mint a short-lived Ably TokenRequest scoped to the authenticated user's four real-time channels (agent jobs, tasks, notifications, chat rooms), subscribe-only. Intended for non-browser clients that authenticate with a bearer token; the browser app uses its own cookie-authenticated endpoint.",
  tags: ["Realtime"],
  responses: {
    200: jsonSuccessResponse(
      ablyTokenRequestSchema,
      "Ably token request created",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    500: jsonErrorResponse("Internal Server Error"),
    503: jsonErrorResponse("Realtime is not configured"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);

    // Optional capability: environments that do not serve non-browser clients
    // need no subscribe key, and say so rather than failing at boot.
    if (!isSubscribeClientConfigured()) {
      throw serviceUnavailable("Realtime is not configured");
    }

    const tokenRequest = await getSubscribeRestClient().auth.createTokenRequest(
      {
        clientId: userContext.userId,
        capability: subscribeCapability(userContext.userId),
        ttl: TOKEN_TTL_MS,
      },
    );

    return ok(c, ablyTokenRequestSchema.parse(tokenRequest));
  });
}
