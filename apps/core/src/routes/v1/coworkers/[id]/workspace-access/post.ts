import { createRoute } from "@hono/zod-openapi";

import {
  toCoworkerWorkspaceAccessApiShape,
  upsertCoworkerWorkspaceAccess,
} from "@/helpers/coworker-workspace-access";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { hasAdminRole, requireUserAuthContext } from "@/middleware/auth";
import {
  coworkerWorkspaceAccessSchema,
  createCoworkerWorkspaceAccessRequestSchema,
} from "@/schemas/coworker-workspace-access.schema";

import { paramsSchema } from "../schema";

const route = createRoute({
  method: "post",
  path: "/{id}/workspace-access",
  operationId: "createCoworkerWorkspaceAccess",
  description:
    "Propose or directly grant coworker workspace access. Platform admin and vendor admin (member workspace) grant immediately; vendor admin foreign workspace creates PENDING.",
  tags: ["Coworkers"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: createCoworkerWorkspaceAccessRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      coworkerWorkspaceAccessSchema,
      "Coworker workspace access created or upgraded",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userAuth = requireUserAuthContext(c.var.authContext);
    const { id: coworkerId } = c.req.valid("param");
    const { workspaceId } = c.req.valid("json");

    const access = await upsertCoworkerWorkspaceAccess({
      coworkerId,
      workspaceId,
      actorUserId: userAuth.userId,
      isPlatformAdmin: hasAdminRole(userAuth.role),
    });

    return created(
      c,
      coworkerWorkspaceAccessSchema.parse(
        toCoworkerWorkspaceAccessApiShape(access),
      ),
    );
  });
}
