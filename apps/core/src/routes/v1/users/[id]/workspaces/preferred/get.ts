import { createRoute, z } from "@hono/zod-openapi";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { listAuthorizedUserWorkspaces } from "@/helpers/coworker-user-context-binding";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { userWorkspaceSchema } from "@/schemas/user-workspace.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/workspaces/preferred",
    description:
      "The workspace a new session opens for the user (path `me` for the session user, or a user id the caller may access): the row `GET /users/{id}/workspaces` marks `preferred`. A user with at least one workspace always has one; with none it is 404 `no_preferred_workspace`. A coworker with `X-Context-User-Id` gets it only when its vendor may act in that workspace, otherwise 404 `no_preferred_workspace` (list the workspaces to pick another); with no workspace to act in at all it gets 403. A Soko Bot gets its owner's preferred workspace.",
    tags: ["Users"],
    request: { params },
    responses: {
      200: jsonSuccessResponse(userWorkspaceSchema, "The preferred workspace", {
        data: {
          id: "11111111-1111-7111-8111-111111111111",
          kind: "organization",
          name: "Acme",
          organizationId: "org_123",
          slug: "acme-x1y2z3",
          logo: null,
          websiteUrl: "https://acme.com",
          preferred: true,
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      }),
      400: jsonErrorResponse(
        "Bad Request - invalid coworker context headers (this route needs no `X-Context-Organization-Id`)",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse(
        "Not Found - User not found, or no preferred workspace the caller may see",
      ),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const { workspaces } = await listAuthorizedUserWorkspaces(
      c.var.authContext,
      resolvedUserId,
    );
    const preferred = workspaces.find((workspace) => workspace.preferred);
    if (!preferred) {
      throw notFound("No preferred workspace", {
        kind: CORE_API_ERROR_KINDS.NO_PREFERRED_WORKSPACE,
      });
    }

    c.header("Cache-Control", "no-store");
    return ok(c, userWorkspaceSchema.parse(preferred));
  });
}
