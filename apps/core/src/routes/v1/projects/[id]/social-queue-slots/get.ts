import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { requireSocialBetaAccess } from "@/helpers/social-beta-access";
import { requireSocialPostActor } from "@/helpers/social-post-access";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  socialQueueSlotProjectParamsSchema,
  socialQueueSlotsResponseSchema,
} from "@/schemas/social-queue-slot.schema";
import { listSocialQueueSlots } from "@/services/social-queue.service";

import { mapSocialPostServiceError } from "../social-posts/route-helpers.js";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/social-queue-slots",
    description:
      "List a Project's weekly posting-queue times. Requires an interactive session or an authorized task-capable Coworker with user context and Calendar beta access.",
    tags: ["Projects"],
    request: { params: socialQueueSlotProjectParamsSchema },
    responses: {
      200: jsonSuccessResponse(
        socialQueueSlotsResponseSchema,
        "Project posting-queue slots",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const userContext = await requireSocialPostActor(c.var.authContext);
    await requireSocialBetaAccess(userContext.userId, prisma);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");

    try {
      const slots = await listSocialQueueSlots({
        projectId,
        workspaceId: workspaceContext.workspaceId,
      });
      return ok(c, socialQueueSlotsResponseSchema.parse(slots));
    } catch (error) {
      return mapSocialPostServiceError(error);
    }
  });
}
