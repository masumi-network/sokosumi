import { createRoute } from "@hono/zod-openapi";
import { forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  taskTagSuggestionInputSchema,
  taskTagSuggestionResponseSchema,
} from "@/schemas/task-tag-suggestion.schema";
import { suggestTaskTags } from "@/services/task-tag-suggestions.service";

const route = createRoute({
  method: "post",
  path: "/tag-suggestions",
  operationId: "suggestTaskTags",
  tags: ["Tasks"],
  description:
    "Suggest tags for authored task content. Suggestions are optional and never required to create a task.",
  request: {
    body: {
      content: { "application/json": { schema: taskTagSuggestionInputSchema } },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      taskTagSuggestionResponseSchema,
      "Suggested tags and signed receipt",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    422: jsonErrorResponse("Unprocessable entity"),
    429: jsonErrorResponse("Too many requests"),
    503: jsonErrorResponse("Suggestions unavailable"),
  },
});
export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const user = requireOwnerUserContext(c.var.authContext);
    if (
      c.var.authContext.actor !== "user" ||
      c.var.authContext.authenticationMethod !== "session"
    )
      throw forbidden("Tag suggestions require an interactive session");
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    await requireAssignedOrganizationSeat(
      user.userId,
      workspace.organizationId,
    );
    return ok(
      c,
      await suggestTaskTags(
        { userId: user.userId, workspaceId: workspace.workspaceId },
        c.req.valid("json"),
      ),
    );
  });
}
