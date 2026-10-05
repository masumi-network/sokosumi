import { randomUUID } from "node:crypto";

import { createRoute, z } from "@hono/zod-openapi";
import { buildOrganizationMetadataWithUrl } from "@sokosumi/utils";
import slugify from "slugify";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { createPersonalWorkspace } from "@/helpers/personal-workspace";
import { created } from "@/helpers/response";
import { getUserWorkspace } from "@/helpers/user-workspaces";
import { auth } from "@/lib/auth";
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
import { setPreferredOrganizationId } from "@/services/preferred-organization.service";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "post",
  path: "/workspaces",
  description:
    'Create a workspace for the user (path `me` for the session user, or a user id the caller may access) and make it preferred. `{ "kind": "personal" }` creates the one personal workspace (409 when it exists). `{ "kind": "organization", "name", "websiteUrl" }` creates an organization owned by the user, with the website stored in its metadata; the organization limit applies (403). See ADR 0051.',
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

/** Web's slug shape: the slugified name plus a short random suffix. */
function organizationSlug(name: string): string {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 6);
  return [slugify(name, { lower: true, strict: true }), suffix]
    .filter(Boolean)
    .join("-");
}

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);
    const body = c.req.valid("json");

    if (body.kind === "personal") {
      const workspace = await createPersonalWorkspace(resolvedUserId);
      return created(
        c,
        userWorkspaceSchema.parse(
          await getUserWorkspace(resolvedUserId, { id: workspace.id }),
        ),
      );
    }

    // No headers: Better Auth treats a userId body as a system action for
    // that user and still runs the organization hooks.
    const organization = await auth.api.createOrganization({
      body: {
        name: body.name,
        slug: organizationSlug(body.name),
        metadata: buildOrganizationMetadataWithUrl(null, body.websiteUrl) ?? {},
        userId: resolvedUserId,
      },
    });
    await setPreferredOrganizationId(resolvedUserId, organization.id);

    return created(
      c,
      userWorkspaceSchema.parse(
        await getUserWorkspace(resolvedUserId, {
          organizationId: organization.id,
        }),
      ),
    );
  });
}
