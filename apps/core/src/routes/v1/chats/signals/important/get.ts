import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatCatchUpItemSchema } from "@/schemas/chat-signal.schema";
import { listImportantChatItems } from "@/services/chat-catch-up-summary.service";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Rows Home shows at most. */
const IMPORTANT_LIMIT = 8;

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/important",
    description:
      "The viewer's important unread chat messages from the last 24 hours, newest first, one per room, at most 8: from someone else, in an unmuted room, and tagged by Jev as asking something of the viewer or changing their work (needs you, escalation, urgent, blocker, bug, decision made or needed, announcement, work request, review). Home lists these.",
    tags: ["Chat Signals"],
    responses: {
      200: jsonSuccessResponse(
        z.array(chatCatchUpItemSchema),
        "Important unread chat messages",
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
      z.array(chatCatchUpItemSchema).parse(
        await listImportantChatItems({
          userId,
          organizationId,
          since: new Date(Date.now() - DAY_MS),
          limit: IMPORTANT_LIMIT,
        }),
      ),
    );
  });
}
