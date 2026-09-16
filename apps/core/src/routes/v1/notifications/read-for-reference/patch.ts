import { createRoute, z } from "@hono/zod-openapi";
import { NotificationKind } from "@sokosumi/database";

import { markNotificationsRead } from "@/helpers/notification-read";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";

/**
 * The kinds whose own page is allowed to clear its notifications.
 *
 * Chat is absent on purpose. Opening a room already clears its rows, and does
 * more besides: it moves the membership's `lastReadAt` and republishes what it
 * cleared so the sidebar badge and other tabs agree. A second route doing half
 * of that would leave the room's surfaces disagreeing about the same rows.
 */
const READABLE_BY_REFERENCE_KINDS = [
  NotificationKind.TASK,
  NotificationKind.JOB,
] as const;

const bodySchema = z
  .object({
    kind: z.enum(READABLE_BY_REFERENCE_KINDS).openapi({
      description: "Kind of the notifications to mark read.",
      example: "TASK",
    }),
    referenceId: z.string().min(1).openapi({
      description:
        "The task or job the notifications point at. Required and non-empty, so this route can never read a kind in bulk.",
      example: "cm123456789abcdefghij",
    }),
  })
  .openapi("MarkReadForReferenceRequest");

const responseSchema = z
  .object({
    count: z.number().int().min(0).openapi({
      description: "Number of notifications this call marked as read",
      example: 2,
    }),
  })
  .openapi("MarkReadForReferenceResponse");

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "patch",
    path: "/read-for-reference",
    description:
      "Mark every unread notification about one task or job as read for the interactive session user. Called by the task and job pages, so that visiting the thing a notification is about counts as reading it. Chat is not accepted: a room clears its own rows through the room-read route.",
    tags: ["Notifications"],
    request: {
      body: {
        content: { "application/json": { schema: bodySchema } },
      },
    },
    responses: {
      200: jsonSuccessResponse(responseSchema, "Notifications marked as read", {
        data: { count: 2 },
        meta: {
          timestamp: "2026-06-16T15:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      }),
      401: jsonErrorResponse("Unauthorized"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { kind, referenceId } = c.req.valid("json");

    // The shared write, so this route cannot reach a row the feed would never
    // show by scoping it itself. The reader's own id, the unread state and the
    // feed rule all come from there; the reference is all this route adds.
    // Which also means no access check on the task or the job is needed or
    // wanted: the only rows this can reach are ones already written for the
    // caller.
    //
    // Nothing is republished, and `clearedRoomIds` is empty by construction:
    // it carries chat rows, and chat is not a kind this route accepts. A
    // cleared-row event exists for the banner a room message stands for; a
    // task or job row has no such banner.
    const { count } = await markNotificationsRead(userContext.userId, {
      kind,
      referenceId,
    });

    return ok(c, responseSchema.parse({ count }));
  });
}
