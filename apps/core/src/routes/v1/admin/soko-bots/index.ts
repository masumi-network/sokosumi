import { createRoute, z } from "@hono/zod-openapi";
import { SOKO_BOT_CAPABILITIES, SOKO_BOT_SKILLS } from "@sokosumi/soko-bot";
import { waitUntil } from "@vercel/functions";
import { listGatewayModels } from "@/clients/ai-gateway.client";
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
  sokoBotDeletionResultSchema,
  sokoBotGatewayModelListSchema,
  sokoBotVersionDetailSchema,
  sokoBotVersionListSchema,
  sokoBotVersionWriteSchema,
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
import { deleteSokoBot } from "@/services/soko-bot-deletion.service";
import { getSokoBotQualityOverview } from "@/services/soko-bot-quality.service";
import {
  archiveAuthoredVersion,
  createAuthoredVersion,
  getDefaultSokoBotVersionId,
  listSokoBotVersions,
  promoteSokoBotVersion,
  updateAuthoredVersion,
} from "@/services/soko-bot-version.service";

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

/** Shapes a resolved version for the API. */
function versionDetail(
  version: {
    id: string;
    name: string;
    createdAt: string;
    summary: string;
    model: string;
    systemPrompt: string;
    skills: readonly string[];
    capabilities?: readonly string[];
    inferenceRegion?: "eu" | "us";
  },
  authored: boolean,
  defaultVersionId: string,
) {
  return sokoBotVersionDetailSchema.parse({
    id: version.id,
    name: version.name,
    createdAt: version.createdAt,
    summary: version.summary,
    model: version.model,
    inferenceRegion: version.inferenceRegion ?? null,
    systemPrompt: version.systemPrompt,
    skills: [...version.skills],
    capabilities: [...(version.capabilities ?? [])],
    authored,
    isDefault: version.id === defaultVersionId,
  });
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
      sokoBotId: z.string().uuid().optional(),
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

// ---------------------------------------------------------------------------
// Version authoring
//
// Built-in versions stay immutable in code; these endpoints manage the
// database-backed ones and the promoted default. Admin-only: the system prompt
// carries the operating contract, so editing it changes how every new bot
// behaves.
// ---------------------------------------------------------------------------

const listVersionsRoute = createRoute({
  method: "get",
  path: "/versions",
  operationId: "listAdminSokoBotVersions",
  tags: ["Admin"],
  responses: {
    200: jsonSuccessResponse(
      sokoBotVersionListSchema,
      "Built-in and authored versions, with the tools and skills available",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

app.openapi(listVersionsRoute, async (c) => {
  requireAdminAuthContext(c.var.authContext);
  const [versions, defaultVersionId] = await Promise.all([
    listSokoBotVersions(),
    getDefaultSokoBotVersionId(),
  ]);
  return ok(
    c,
    sokoBotVersionListSchema.parse({
      defaultVersionId,
      versions: versions.map((version) =>
        versionDetail(version, version.authored, defaultVersionId),
      ),
      availableCapabilities: [...SOKO_BOT_CAPABILITIES],
      availableSkills: SOKO_BOT_SKILLS.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        installed: false,
      })),
    }),
  );
});

const modelsRoute = createRoute({
  method: "get",
  path: "/versions/models",
  operationId: "listAdminSokoBotGatewayModels",
  tags: ["Admin"],
  responses: {
    200: jsonSuccessResponse(
      sokoBotGatewayModelListSchema,
      "Models available on the AI Gateway",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

app.openapi(modelsRoute, async (c) => {
  requireAdminAuthContext(c.var.authContext);
  const models = await listGatewayModels();
  return ok(c, sokoBotGatewayModelListSchema.parse({ models }));
});

const createVersionRoute = createRoute({
  method: "post",
  path: "/versions",
  operationId: "createAdminSokoBotVersion",
  tags: ["Admin"],
  request: {
    body: {
      content: { "application/json": { schema: sokoBotVersionWriteSchema } },
    },
  },
  responses: {
    200: jsonSuccessResponse(sokoBotVersionDetailSchema, "Created version"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    409: jsonErrorResponse("Version id already in use"),
    422: jsonErrorResponse("Validation error"),
  },
});

app.openapi(createVersionRoute, async (c) => {
  const auth = requireAdminAuthContext(c.var.authContext);
  const body = c.req.valid("json");
  const version = await createAuthoredVersion(body, auth.userId);
  return ok(
    c,
    versionDetail(version, true, await getDefaultSokoBotVersionId()),
  );
});

const updateVersionRoute = createRoute({
  method: "patch",
  path: "/versions/{slug}",
  operationId: "updateAdminSokoBotVersion",
  tags: ["Admin"],
  request: {
    params: z.object({ slug: z.string().min(2).max(41) }),
    body: {
      content: {
        "application/json": {
          schema: sokoBotVersionWriteSchema.omit({ slug: true }),
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(sokoBotVersionDetailSchema, "Updated version"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not found"),
    422: jsonErrorResponse("Validation error"),
  },
});

app.openapi(updateVersionRoute, async (c) => {
  requireAdminAuthContext(c.var.authContext);
  const { slug } = c.req.valid("param");
  const version = await updateAuthoredVersion(slug, c.req.valid("json"));
  return ok(
    c,
    versionDetail(version, true, await getDefaultSokoBotVersionId()),
  );
});

const deleteBotRoute = createRoute({
  method: "delete",
  path: "/{sokoBotId}",
  operationId: "deleteAdminSokoBot",
  tags: ["Admin"],
  request: { params: z.object({ sokoBotId: z.string().uuid() }) },
  responses: {
    200: jsonSuccessResponse(sokoBotDeletionResultSchema, "Soko Bot deleted"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not found"),
    409: jsonErrorResponse("Conflict"),
  },
});

app.openapi(deleteBotRoute, async (c) => {
  requireAdminAuthContext(c.var.authContext);
  // No SokoBotAdminAction row: that table is foreign-keyed to the bot, so an
  // audit entry would either violate the constraint or be cascaded away with
  // the row it describes. Deletions are captured by request logging instead.
  const result = await deleteSokoBot(c.req.valid("param").sokoBotId);
  return ok(c, result);
});

const archiveVersionRoute = createRoute({
  method: "delete",
  path: "/versions/{slug}",
  operationId: "archiveAdminSokoBotVersion",
  tags: ["Admin"],
  request: { params: z.object({ slug: z.string().min(2).max(41) }) },
  responses: {
    200: jsonSuccessResponse(z.object({ archived: z.boolean() }), "Archived"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not found"),
    409: jsonErrorResponse("Conflict"),
  },
});

app.openapi(archiveVersionRoute, async (c) => {
  requireAdminAuthContext(c.var.authContext);
  await archiveAuthoredVersion(c.req.valid("param").slug);
  return ok(c, { archived: true });
});

const promoteVersionRoute = createRoute({
  method: "post",
  path: "/versions/{slug}/promote",
  operationId: "promoteAdminSokoBotVersion",
  tags: ["Admin"],
  request: { params: z.object({ slug: z.string().min(2).max(41) }) },
  responses: {
    200: jsonSuccessResponse(
      z.object({ defaultVersionId: z.string() }),
      "New bots are created on this version",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not found"),
  },
});

app.openapi(promoteVersionRoute, async (c) => {
  requireAdminAuthContext(c.var.authContext);
  const { slug } = c.req.valid("param");
  await promoteSokoBotVersion(slug);
  return ok(c, { defaultVersionId: slug });
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
