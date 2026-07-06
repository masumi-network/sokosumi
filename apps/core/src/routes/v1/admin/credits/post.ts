import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  createFreeCreditGrantSchema,
  freeCreditGrantSchema,
} from "@/schemas/free-credit.schema";
import { freeCreditAdminService } from "@/services/free-credit-admin.service";

import { mapFreeCreditError } from "./helpers.js";

const route = createRoute({
  method: "post",
  path: "/",
  operationId: "createAdminFreeCreditGrant",
  description:
    "Grant free credits directly to a user or organization (admin only). Credits are created immediately without a Stripe invoice. Missing or invalid targets return 400 (not 404), matching admin invoice grants.",
  tags: ["Admin"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createFreeCreditGrantSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      freeCreditGrantSchema,
      "The created free credit grant",
      {
        data: {
          bucketId: "bucket_123",
          targetType: "user",
          targetId: "user_123",
          targetName: "Ada Lovelace",
          credits: 500,
          ttlDays: 30,
          referenceNote: "Billing issue",
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse("Bad Request - validation failed"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { targetType, targetId, credits, ttlDays, referenceNote } =
      c.req.valid("json");

    const grant = await freeCreditAdminService
      .grantFreeCredits({
        target: { targetType, targetId },
        credits,
        ttlDays,
        referenceNote,
      })
      .catch(mapFreeCreditError);

    return ok(c, freeCreditGrantSchema.parse(grant));
  });
}
