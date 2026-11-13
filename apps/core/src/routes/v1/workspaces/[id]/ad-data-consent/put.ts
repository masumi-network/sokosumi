import { createRoute } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  WORKSPACE_AD_DATA_POLICY_VERSION,
  workspaceAdDataConsentSchema,
  workspaceAdDataConsentWriteSchema,
} from "@/schemas/workspace-ad-data-consent.schema";
import {
  requireWorkspaceConsentAccess,
  workspaceConsentParamsSchema,
} from "./access";

const route = createRoute({
  method: "put",
  path: "/{id}/ad-data-consent",
  operationId: "putWorkspaceAdDataConsent",
  description:
    "Set workspace ad data consent as its owner or an organization admin",
  tags: ["Workspaces"],
  request: {
    params: workspaceConsentParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": { schema: workspaceAdDataConsentWriteSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      workspaceAdDataConsentSchema,
      "Workspace ad data consent",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden - Workspace owner or admin required"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    await requireWorkspaceConsentAccess({
      workspaceId: id,
      userId: userContext.userId,
      allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
    });

    const data = {
      ...body,
      decidedByUserId: userContext.userId,
      decidedAt: new Date(),
      policyVersion: WORKSPACE_AD_DATA_POLICY_VERSION,
    };
    const consent = await prisma.workspaceAdDataConsent.upsert({
      where: { workspaceId: id },
      create: { workspaceId: id, ...data },
      update: data,
    });

    return ok(c, workspaceAdDataConsentSchema.parse(consent));
  });
}
