import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatSignalListItemSchema } from "@/schemas/chat-signal.schema";
import { listChatOpenLoops } from "@/services/chat-signal-views.service";
import { mapChatSignalListItems } from "../list-items";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/open-loops",
    description:
      "The viewer's open loops across their rooms (chat signals): questions and decisions asked of them that they have not answered after three hours, and commitments they made whose date has passed. A loop closed by a Task or dismissed is left out. Looks back 14 days; at most 50, newest first.",
    tags: ["Chat Signals"],
    responses: {
      200: jsonSuccessResponse(
        z.array(chatSignalListItemSchema),
        "The viewer's open loops",
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
        await listChatOpenLoops(userId, organizationId),
        userId,
      ),
    );
  });
}
