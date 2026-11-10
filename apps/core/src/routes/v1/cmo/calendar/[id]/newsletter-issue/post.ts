import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireFirstPartyUserAuthContext } from "@/middleware/auth";
import { cmoUpdateIdParamsSchema } from "@/schemas/cmo.schema";
import { prepareCalendarNewsletterIssue } from "@/services/cmo-newsletter.service";

import { rethrow } from "../../../helpers";

const route = createRoute({
  method: "post",
  path: "/calendar/{id}/newsletter-issue",
  operationId: "prepareCmoCalendarNewsletterIssue",
  tags: ["CMO"],
  description:
    "Open the newsletter issue linked to an approved calendar piece. On the first request, link the selected project draft or create one from the saved copy. Never approves or schedules an issue.",
  request: {
    params: cmoUpdateIdParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            projectId: z.uuid(),
            strategyId: z.uuid(),
            issueId: z.uuid().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      z.object({ issueId: z.uuid() }),
      "Newsletter issue",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Newsletter, calendar piece or draft not found"),
    409: jsonErrorResponse("Calendar or newsletter conflict"),
    422: jsonErrorResponse("Invalid request or newsletter copy"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireFirstPartyUserAuthContext(c.var.authContext);
    const { id: entryId } = c.req.valid("param");
    const input = c.req.valid("json");
    const issueId = await prepareCalendarNewsletterIssue({
      ...input,
      userId,
      entryId,
    }).catch(rethrow);
    return ok(c, { issueId });
  });
}
