import { createRoute, z } from "@hono/zod-openapi";
import { listAuthorizedUserWorkspaces } from "@/helpers/coworker-user-context-binding";
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
import { userWorkspacesSchema } from "@/schemas/user-workspace.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/workspaces",
    description:
      "List the workspaces the user can act in (path `me` for the session user, or a user id the caller may access): the personal workspace first, then organization workspaces, with the one a new session opens marked `preferred`, and the count of pending organization invitations. An empty list means the user still needs identity onboarding (ADR 0051). A coworker with `X-Context-User-Id` sees only the workspaces its vendor may act in (granted, or a task it or a same-vendor coworker is assigned), no invitation count, and none marked preferred when the preferred one is hidden; with none to see it gets 403. A Soko Bot sees its owner's full list.",
    tags: ["Users"],
    request: { params },
    responses: {
      200: jsonSuccessResponse(userWorkspacesSchema, "The user's workspaces", {
        data: {
          workspaces: [
            {
              id: "11111111-1111-7111-8111-111111111111",
              kind: "organization",
              name: "Acme",
              organizationId: "org_123",
              slug: "acme-x1y2z3",
              logo: null,
              websiteUrl: "https://acme.com",
              preferred: true,
            },
          ],
          pendingInvitationCount: 0,
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
      404: jsonErrorResponse("Not Found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const workspaces = await listAuthorizedUserWorkspaces(
      c.var.authContext,
      resolvedUserId,
    );

    c.header("Cache-Control", "no-store");
    return ok(c, userWorkspacesSchema.parse(workspaces));
  });
}
