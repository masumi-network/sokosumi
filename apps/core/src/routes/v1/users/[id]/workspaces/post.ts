import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { createOrganizationWorkspace } from "@/helpers/organization-workspace";
import { createPersonalWorkspace } from "@/helpers/personal-workspace";
import { created } from "@/helpers/response";
import { getUserWorkspace } from "@/helpers/user-workspaces";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import {
  createUserWorkspaceSchema,
  userWorkspaceSchema,
} from "@/schemas/user-workspace.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "post",
  path: "/workspaces",
  description:
    'Create a workspace for the user (path `me` for the session user, or a user id the caller may access) and make it preferred. `{ "kind": "personal" }` creates the one personal workspace (409 when it exists). `{ "kind": "organization", "name", "websiteUrl" }` creates an organization owned by the user, with the website stored in its metadata; the organization limit applies (403). If making a new organization preferred fails after it is created, it is still returned (201) with `preferred: false`. See ADR 0051.',
  tags: ["Users"],
  request: {
    params,
    body: {
      content: {
        "application/json": {
          schema: createUserWorkspaceSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(userWorkspaceSchema, "The created workspace", {
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
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden - The organization limit is reached"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict - Personal workspace already exists"),
    422: jsonErrorResponse("Unprocessable Entity - Invalid body"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);
    const body = c.req.valid("json");

    const workspace =
      body.kind === "personal"
        ? await getUserWorkspace(resolvedUserId, {
            id: (await createPersonalWorkspace(resolvedUserId)).id,
          })
        : await createOrganizationWorkspace(resolvedUserId, body);

    return created(c, userWorkspaceSchema.parse(workspace));
  });
}
