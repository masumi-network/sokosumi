import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatSignalListItemSchema } from "@/schemas/chat-signal.schema";
import { listChatNeedsYou } from "@/services/chat-signal-views.service";
import { mapChatSignalListItems } from "../list-items";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/needs-you",
    description:
      "Unread messages across the rooms the sidebar lists for the viewer, less muted rooms, that ask something of them: a question or a decision Jev read as addressed to them (chat signals). Newest first, at most 50.",
    tags: ["Chat Signals"],
    responses: {
      200: jsonSuccessResponse(
        z.array(chatSignalListItemSchema),
        "Unread messages that need the viewer",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId, organizationId } = requireUserAuthContext(
      c.var.authContext,
    );
    return ok(
      c,
      mapChatSignalListItems(
        await listChatNeedsYou(userId, organizationId),
        userId,
      ),
    );
  });
}
