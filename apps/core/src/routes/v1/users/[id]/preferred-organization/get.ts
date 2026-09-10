import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { preferredOrganizationSchema } from "@/schemas/preferred-organization.schema";
import { resolveActiveOrganizationIdForSession } from "@/services/preferred-organization.service";

const route = createRoute({
  method: "get",
  path: "/preferred-organization",
  description:
    "Resolve the workspace to restore using the same rules as web sign-in: the saved organization when membership still exists, otherwise personal when available, otherwise the first remaining organization. This read does not update the saved preference or an active session. Check workspace-access first: null means personal only when a personal workspace exists; it also represents no workspace when setup is required. Path `me` selects the authenticated user; explicit user ids follow the existing user-route access rules.",
  tags: ["Users"],
  request: { params: z.object({ id: usersRoutePathUserIdSchema }) },
  responses: {
    200: jsonSuccessResponse(
      preferredOrganizationSchema,
      "The resolved organization selection for workspace restoration",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("User not found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);
    const organizationId =
      await resolveActiveOrganizationIdForSession(resolvedUserId);
    c.header("Cache-Control", "no-store");
    return ok(c, preferredOrganizationSchema.parse({ organizationId }));
  });
}
