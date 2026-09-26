import { createRoute, z } from "@hono/zod-openapi";
import { NotificationKind } from "@sokosumi/database";
import { waitUntil } from "@vercel/functions";

import { markNotificationsRead } from "@/helpers/notification-read";
import { publishClearedNotifications } from "@/helpers/notifications";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";

/**
 * Upper bound on one request. The notification center holds ten rows, so a
 * caller asking for more than this has lost track of what it is reading, and
 * the reader has `read-all` for the rest.
 */
const MAX_NOTIFICATION_IDS = 25;

/**
 * The kinds whose own page is allowed to clear its notifications.
 *
 * Chat is absent on purpose. Opening a room already clears its rows, and does
 * more besides: it moves the membership's `lastReadAt` and republishes what it
 * cleared so the sidebar badge and other tabs agree. A second path doing half
 * of that would leave the room's surfaces disagreeing about the same rows.
 */
const READABLE_BY_REFERENCE_KINDS = [
  NotificationKind.TASK,
  NotificationKind.JOB,
] as const;

// Strict, so a body carrying both `ids` and a reference is refused rather than
// read as whichever variant happens to match first.
const byIdsSchema = z
  .strictObject({
    ids: z
      .array(z.string())
      .min(1)
      .max(MAX_NOTIFICATION_IDS)
      .openapi({
        description: "Notification IDs to mark as read",
        example: ["cm123456789abcdefghij"],
      }),
  })
  .openapi("MarkNotificationsReadByIdsRequest");

const byReferenceSchema = z
  .strictObject({
    kind: z.enum(READABLE_BY_REFERENCE_KINDS).openapi({
      description: "Kind of the notifications to mark read.",
      example: "TASK",
    }),
    referenceId: z.string().min(1).openapi({
      description:
        "The task or job the notifications point at. Required and non-empty, so this can never read a kind in bulk.",
      example: "cm123456789abcdefghij",
    }),
  })
  .openapi("MarkNotificationsReadByReferenceRequest");

const requestSchema = z
  .union([byIdsSchema, byReferenceSchema])
  .openapi("MarkNotificationsReadRequest");

const responseSchema = z
  .object({
    count: z.number().int().min(0).openapi({
      description: "Number of notifications this request marked as read",
      example: 3,
    }),
  })
  .openapi("MarkNotificationsReadResponse");

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "patch",
    path: "/read",
    description:
      "Mark in-app notification-center items as read for the interactive session user, either the named ids or every unread row about one task or job. Scoped by the feed rule and by the reader's own rows, so an id the feed would never show, and an id belonging to someone else, are both ignored rather than refused. A mention read here is read everywhere, including the room's sidebar badge, which counts the same rows. The task and job pages send a reference, so that visiting the thing a notification is about counts as reading it; chat is not accepted there, because a room clears its own rows through the room-read route.",
    tags: ["Notifications"],
    request: {
      body: {
        content: { "application/json": { schema: requestSchema } },
        description: "Notification IDs, or one task or job, to mark as read",
      },
    },
    responses: {
      200: jsonSuccessResponse(responseSchema, "Notifications marked as read", {
        data: { count: 3 },
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
    const body = c.req.valid("json");

    if ("ids" in body) {
      const { count, clearedRoomIds } = await markNotificationsRead(
        userContext.userId,
        { id: { in: body.ids } },
      );

      // Scheduled rather than awaited, for the same reason the single-row
      // route schedules it: a failed publish must not cost the reader the
      // read.
      waitUntil(publishClearedNotifications(clearedRoomIds));

      return ok(c, responseSchema.parse({ count }));
    }

    // The reference is all this variant adds to the shared write. The reader's
    // own id, the unread state and the feed rule come from there, so no access
    // check on the task or the job is needed or wanted: the only rows this can
    // reach are ones already written for the caller.
    //
    // Nothing is republished, and `clearedRoomIds` is empty by construction:
    // it carries chat rows, and chat is not a kind this variant accepts. A
    // cleared-row event exists for the banner a room message stands for; a
    // task or job row has no such banner.
    const { count } = await markNotificationsRead(userContext.userId, {
      kind: body.kind,
      referenceId: body.referenceId,
    });

    return ok(c, responseSchema.parse({ count }));
  });
}
