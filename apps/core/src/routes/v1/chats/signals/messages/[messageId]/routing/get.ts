import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { chatSignalRoutingSuggestionSchema } from "@/schemas/chat-signal.schema";
import { suggestCoworkersForChatMessage } from "@/services/chat-signal-routing.service";
import { messageParamsSchema } from "../../../params";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/messages/{messageId}/routing",
    description:
      "Coworkers a message asking for work could be handed to (chat signals): usable in the viewer's workspace, ranked by Jev's fit, at most three. Empty when Jev did not read the message as a work request, or nothing fits.",
    tags: ["Chat Signals"],
    request: { params: messageParamsSchema },
    responses: {
      200: jsonSuccessResponse(
        z.array(chatSignalRoutingSuggestionSchema),
        "Routing suggestions",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Message not found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { messageId } = c.req.valid("param");
    return ok(
      c,
      z.array(chatSignalRoutingSuggestionSchema).parse(
        await suggestCoworkersForChatMessage({
          messageId,
          userId,
          workspaceId,
        }),
      ),
    );
  });
}
