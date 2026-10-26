import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatCatchUpSummarySchema } from "@/schemas/chat-signal.schema";
import { getChatCatchUpSummary } from "@/services/chat-catch-up-summary.service";

const querySchema = z.object({
  roomId: z
    .string()
    .uuid()
    .optional()
    .openapi({
      param: { name: "roomId", in: "query" },
      description: "One room's summary; across every unmuted room without it.",
    }),
});

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/summary",
    description:
      'The viewer\'s "while you were away": what is unread since they last read each room, sorted by what it asks of them (needs you, decisions, open loops, highlights), from the messages Jev tagged. The sections are live; the written headline and room lines come from a cheap EU-routed model and are cached until a tagged message arrives that they have not read.',
    tags: ["Chat Signals"],
    request: { query: querySchema },
    responses: {
      200: jsonSuccessResponse(chatCatchUpSummarySchema, "Catch-up summary"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Room not found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId, organizationId } = requireUserAuthContext(
      c.var.authContext,
    );
    const { roomId } = c.req.valid("query");
    return ok(
      c,
      chatCatchUpSummarySchema.parse(
        await getChatCatchUpSummary({
          userId,
          organizationId,
          roomId: roomId ?? null,
        }),
      ),
    );
  });
}
