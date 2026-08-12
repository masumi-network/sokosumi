import { createRoute, z } from "@hono/zod-openapi";
import {
  buildUserMetadataWithOnboardingProfile,
  getUserOnboardingProfile,
  parseUserMetadata,
  serializeMetadataRecord,
} from "@sokosumi/utils";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { serializableTransaction } from "@/lib/db/transaction";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import {
  userOnboardingRequestSchema,
  userOnboardingResponseSchema,
} from "@/schemas/user.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "post",
  path: "/onboarding",
  description:
    "Complete onboarding: path `me` for the session user, or a user id when the caller may access that user's data. An optional `profile` stores the answers collected by the flow; omitted answers keep any previously stored value.",
  tags: ["Users"],
  request: {
    params,
    body: {
      required: false,
      content: {
        "application/json": { schema: userOnboardingRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      userOnboardingResponseSchema,
      "Complete onboarding for the user",
      {
        data: {
          completed: true,
          profile: {
            companySize: "11-50",
            companyType: "agency",
            role: "founder",
            workStyle: "team",
          },
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);
    const profile = c.req.valid("json")?.profile;

    const onboarding = await serializableTransaction(async (tx) => {
      // Read-modify-write on a JSON column. READ COMMITTED lets a concurrent
      // metadata writer (the DESIGN.md route is the other one) interleave
      // between this read and the update, and the later commit silently wins.
      // Serializable turns that into a 409 the caller can retry.
      const existing = await tx.user.findUnique({
        where: { id: resolvedUserId },
        select: { metadata: true },
      });

      const metadata = profile
        ? serializeMetadataRecord(
            buildUserMetadataWithOnboardingProfile(
              parseUserMetadata(existing?.metadata),
              profile,
            ),
          )
        : undefined;

      const updatedUser = await tx.user.update({
        where: { id: resolvedUserId },
        data: {
          onboardingCompleted: true,
          ...(metadata !== undefined ? { metadata } : {}),
        },
        select: {
          metadata: true,
          onboardingCompleted: true,
        },
      });

      return {
        completed: updatedUser.onboardingCompleted,
        profile: getUserOnboardingProfile(updatedUser.metadata),
      };
    }, "Onboarding was updated concurrently. Please retry.");

    return ok(c, userOnboardingResponseSchema.parse(onboarding));
  });
}
