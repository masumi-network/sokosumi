import { createRoute, z } from "@hono/zod-openapi";
import { waitUntil } from "@vercel/functions";

import {
  conflict,
  forbidden,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
  jsonSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import {
  adminSokoBotActionRequestSchema,
  adminSokoBotDetailSchema,
  adminSokoBotListSchema,
  adminSokoBotQualitySchema,
} from "@/schemas/soko-bot.schema";
import { SokoBotBillingAccessError } from "@/services/soko-bot-billing.service";
import {
  SokoBotBusyError,
  SokoBotIdempotencyConflictError,
  SokoBotNotFoundError,
  SokoBotRetryableStartError,
  SokoBotStartAbortedError,
  SokoBotValidationError,
  sokoBotControlPlane,
} from "@/services/soko-bot-control-plane.service";
import { getSokoBotQualityOverview } from "@/services/soko-bot-quality.service";

const app = new OpenAPIHonoWithAuth();
const sokoBotPaginationQuerySchema = cursorPaginationQuerySchema.extend({
  cursor: z.string().uuid().optional(),
});

const botParams = z.object({
  sokoBotId: z
    .string()
    .uuid()
    .openapi({ param: { name: "sokoBotId", in: "path" } }),
});

function mapDetail(
  detail: Awaited<ReturnType<typeof sokoBotControlPlane.getForAdmin>>,
) {
  const { user, ...bot } = detail;
  return { ...bot, owner: user };
}

function traceIdFromTraceparent(traceparent: string | undefined) {
  const match = traceparent?.match(
    /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/i,
  );
  return match?.[1]?.toLowerCase();
}

function mapError(error: unknown): never {
  if (error instanceof SokoBotBillingAccessError)
    throw forbidden(error.message);
  if (error instanceof SokoBotNotFoundError) throw notFound(error.message);
  if (error instanceof SokoBotBusyError) throw conflict(error.message);
  if (
    error instanceof SokoBotStartAbortedError ||
    error instanceof SokoBotIdempotencyConflictError ||
    error instanceof SokoBotRetryableStartError
  ) {
    throw conflict(error.message);
  }
  if (error instanceof SokoBotValidationError) {
    throw unprocessableEntity(error.message);
  }
  throw error;
}

const listRoute = createRoute({
  method: "get",
  path: "/",
  operationId: "listAdminSokoBots",
  tags: ["Admin"],
  request: {
    query: sokoBotPaginationQuerySchema.extend({
      query: z.string().trim().max(200).optional(),
    }),
  },
  responses: {
    200: jsonPaginatedSuccessResponse(adminSokoBotListSchema, "Soko Bot fleet"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

app.openapi(listRoute, async (c) => {
  const query = c.req.valid("query");
  const { cursor, take } = parseCursorPagination(query);
  const fleet = await sokoBotControlPlane.listForAdmin(query.query, {
    cursor,
    take,
  });
  const items = fleet.items.map(({ _count, user, ...bot }) => ({
    ...bot,
    owner: user,
    turnCount: _count.turns,
    pendingDecisionCount: _count.pendingDecisions,
    scheduleCount: _count.schedules,
  }));
  return ok(
    c,
    adminSokoBotListSchema.parse({
      total: fleet.total,
      items,
    }),
    createPaginationMeta(items, fleet.total, take, fleet.hasMore, cursor),
  );
});

const qualityRoute = createRoute({
  method: "get",
  path: "/quality",
  operationId: "getAdminSokoBotQuality",
  tags: ["Admin"],
  request: {
    query: z.object({
      versionId: z.string().trim().min(1).max(64).optional(),
    }),
  },
  responses: {
    200: jsonSuccessResponse(
      adminSokoBotQualitySchema,
      "Judge scores over time and per agent version",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

app.openapi(qualityRoute, async (c) => {
  return ok(
    c,
    adminSokoBotQualitySchema.parse(
      await getSokoBotQualityOverview(c.req.valid("query")),
    ),
  );
});

const detailRoute = createRoute({
  method: "get",
  path: "/{sokoBotId}",
  operationId: "getAdminSokoBot",
  tags: ["Admin"],
  request: { params: botParams },
  responses: {
    200: jsonSuccessResponse(adminSokoBotDetailSchema, "Soko Bot diagnostics"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

app.openapi(detailRoute, async (c) => {
  try {
    const detail = await sokoBotControlPlane.getForAdmin(
      c.req.valid("param").sokoBotId,
    );
    return ok(c, adminSokoBotDetailSchema.parse(mapDetail(detail)));
  } catch (error) {
    mapError(error);
  }
});

const actionRoute = createRoute({
  method: "post",
  path: "/{sokoBotId}/actions",
  operationId: "performAdminSokoBotAction",
  tags: ["Admin"],
  request: {
    params: botParams,
    body: {
      content: {
        "application/json": { schema: adminSokoBotActionRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      adminSokoBotDetailSchema,
      "Updated Soko Bot diagnostics",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

app.openapi(actionRoute, async (c) => {
  const operator = requireAdminAuthContext(c.var.authContext);
  try {
    const action = c.req.valid("json");
    const detail = await sokoBotControlPlane.performAdminAction({
      sokoBotId: c.req.valid("param").sokoBotId,
      operatorId: operator.userId,
      ...action,
      requestId: c.var.requestId,
      traceId: traceIdFromTraceparent(c.req.header("traceparent")),
    });
    if (
      action.action === "RETRY_LAST_FAILED" ||
      action.action === "RETRY_SCHEDULE_RUN"
    ) {
      const scheduleRetry =
        action.action === "RETRY_SCHEDULE_RUN"
          ? detail.schedules
              .flatMap((schedule) => schedule.runs)
              .find((run) => run.id === action.targetId)?.turnId
          : null;
      const retry = detail.turns.find(
        (turn) =>
          (scheduleRetry ? turn.id === scheduleRetry : true) &&
          turn.source === "ADMIN_RETRY" &&
          (turn.status === "STARTING" || turn.status === "RUNNING"),
      );
      if (retry) {
        waitUntil(
          sokoBotControlPlane
            .reconcileTurn(retry.id, undefined, retry.leaseToken ?? undefined)
            .catch((error) => {
              console.error("Admin Soko Bot retry reconciliation failed", {
                turnId: retry.id,
                error: error instanceof Error ? error.message : "unknown",
              });
            }),
        );
      }
    }
    return ok(c, adminSokoBotDetailSchema.parse(mapDetail(detail)));
  } catch (error) {
    mapError(error);
  }
});

export default app;
