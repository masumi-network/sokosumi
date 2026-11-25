import { createRoute, z } from "@hono/zod-openapi";
import { unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { failureReviewSchema } from "@/schemas/failure-review.schema";
import { readFailureReview } from "@/services/failure-review.service";

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_DAYS = 31;

const route = createRoute({
  method: "get",
  path: "/",
  operationId: "getAdminFailureReview",
  tags: ["Admin"],
  summary: "What failed in a window, grouped by cause",
  description:
    "Read-only. Platform admins, and coworkers listed in FAILURE_REVIEW_COWORKER_IDS. The window defaults to the 7 days before now and is at most 31 days.",
  request: {
    query: z.object({
      since: z.iso.datetime().optional(),
      until: z.iso.datetime().optional(),
    }),
  },
  responses: {
    200: jsonSuccessResponse(failureReviewSchema, "The failure review"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    422: jsonErrorResponse("Invalid window"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const query = c.req.valid("query");
    const until = query.until ? new Date(query.until) : new Date();
    const since = query.since
      ? new Date(query.since)
      : new Date(until.getTime() - 7 * DAY_MS);
    const length = until.getTime() - since.getTime();
    if (length <= 0 || length > MAX_DAYS * DAY_MS)
      throw unprocessableEntity(
        `since must be before until, at most ${MAX_DAYS} days apart`,
      );
    return ok(
      c,
      failureReviewSchema.parse(await readFailureReview(since, until)),
    );
  });
}
