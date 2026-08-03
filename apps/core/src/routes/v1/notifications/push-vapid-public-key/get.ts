import { createRoute } from "@hono/zod-openapi";
import { getEnv } from "@/config/env";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { pushVapidPublicKeySchema } from "@/schemas/notification.schema";

const route = createRoute({
  method: "get",
  path: "/push-vapid-public-key",
  operationId: "getPushVapidPublicKey",
  description:
    "Return the VAPID public key used to subscribe to Web Push notifications",
  tags: ["Notifications"],
  responses: {
    200: jsonSuccessResponse(
      pushVapidPublicKeySchema,
      "VAPID public key for Web Push",
      {
        data: {
          publicKey: "BPxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        },
        meta: {
          timestamp: "2026-08-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireUserAuthContext(c.var.authContext);
    const { VAPID_PUBLIC_KEY } = getEnv();

    return ok(
      c,
      pushVapidPublicKeySchema.parse({ publicKey: VAPID_PUBLIC_KEY }),
    );
  });
}
