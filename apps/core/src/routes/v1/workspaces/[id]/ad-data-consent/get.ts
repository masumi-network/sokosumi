import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  WORKSPACE_AD_DATA_POLICY_VERSION,
  workspaceAdDataConsentSchema,
} from "@/schemas/workspace-ad-data-consent.schema";
import {
  requireWorkspaceConsentAccess,
  workspaceConsentParamsSchema,
} from "./access";

const route = createRoute({
  method: "get",
  path: "/{id}/ad-data-consent",
  operationId: "getWorkspaceAdDataConsent",
  description: "Read the workspace's opt-in choices for internal ad data use",
  tags: ["Workspaces"],
  request: { params: workspaceConsentParamsSchema },
  responses: {
    200: jsonSuccessResponse(
      workspaceAdDataConsentSchema,
      "Workspace ad data consent",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    await requireWorkspaceConsentAccess({
      workspaceId: id,
      userId: userContext.userId,
    });

    const consent = await prisma.workspaceAdDataConsent.findUnique({
      where: { workspaceId: id },
    });

    return ok(
      c,
      workspaceAdDataConsentSchema.parse(
        consent ?? {
          workspaceId: id,
          shareForImprovement: false,
          allowTraining: false,
          decidedAt: null,
          policyVersion: WORKSPACE_AD_DATA_POLICY_VERSION,
        },
      ),
    );
  });
}
