import { createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import { formatZodErrorMessage, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requireSeoRouteActor } from "@/helpers/project-seo-access";
import { ok } from "@/helpers/response";
import {
  OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import {
  projectSeoWorkspaceSchema,
  seoProjectParamsSchema,
} from "@/schemas/project-seo.schema";
import { syncProjectSeoStatisticsSchema } from "@/schemas/project-seo-statistics.schema";
import { getProjectSeoWorkspace } from "@/services/project-seo.service";
import { syncProjectSeoStatistics } from "@/services/project-seo-statistics.service";
import { collectSeoAuditPerformance } from "@/services/seo-audit-performance";
import { readAuditPerformanceSummaries } from "@/services/seo-audit-performance-summary";

/** A provider read, or the audit Task's own performance read. */
export const syncStatisticsBodySchema = z.union([
  syncProjectSeoStatisticsSchema,
  z
    .strictObject({
      auditTaskId: z.uuid(),
      includePropertyTotals: z.literal(true).optional(),
      includePageDiscovery: z.literal(true).optional(),
    })
    .refine(
      (input) => !input.includePageDiscovery || input.includePropertyTotals,
      "Page discovery requires property performance access",
    ),
]);

/**
 * When both branches fail, Zod reports one pathless "Invalid input" (SOKD-482).
 * Answer for the branch the caller meant (the one that knows every key it
 * sent, else the provider read) and name each field to fix.
 */
export function syncStatisticsValidationHook(result: {
  success: boolean;
  error?: z.ZodError;
}): undefined {
  if (result.success || !result.error) return undefined;
  const [first] = result.error.issues;
  const branches =
    first?.code === "invalid_union" && first.path.length === 0
      ? first.errors
      : null;
  const issues = branches
    ? (branches.find(
        (branch) => !branch.some((issue) => issue.code === "unrecognized_keys"),
      ) ??
      branches[0] ??
      [])
    : result.error.issues;
  const fields = [
    ...new Set(issues.slice(1).map((issue) => issue.path.join("."))),
  ].filter((field) => field && field !== issues[0]?.path.join("."));
  const message = formatZodErrorMessage(new z.ZodError(issues));
  throw unprocessableEntity(
    fields.length > 0
      ? `${message}. Also check: ${fields.join(", ")}.`
      : message,
  );
}

export function createSeoStatisticsSyncRouter(ownerKind: "project" | "audit") {
  const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });
  const route = withOrganizationSlugHeaderParameter(
    createRoute({
      method: "post",
      path: "/sync",
      operationId:
        ownerKind === "audit"
          ? "syncSeoAuditStatistics"
          : "syncProjectSeoStatistics",
      tags: ownerKind === "audit" ? ["SEO"] : ["Projects"],
      request: {
        params: seoProjectParamsSchema,
        body: {
          content: {
            "application/json": {
              schema: syncStatisticsBodySchema,
            },
          },
        },
      },
      responses: {
        200: jsonSuccessResponse(
          projectSeoWorkspaceSchema,
          "Updated native statistics",
        ),
        401: jsonErrorResponse("Unauthorized"),
        403: jsonErrorResponse("Forbidden"),
        404: jsonErrorResponse("Not found"),
        409: jsonErrorResponse("Conflict"),
        422: jsonErrorResponse("Native statistics unavailable"),
      },
    }),
  );
  app.openapi(
    route,
    async (c) => {
      const actor = requireSeoRouteActor(
        {
          authContext: c.get("authContext"),
          workspaceContext: c.get("workspaceContext"),
        },
        { kind: ownerKind, id: c.req.valid("param").id },
      );
      try {
        const input = c.req.valid("json");
        if ("auditTaskId" in input) {
          const pageIds = await collectSeoAuditPerformance(
            input.auditTaskId,
            actor,
            input.includePropertyTotals,
            input.includePageDiscovery,
          );
          const workspace = await getProjectSeoWorkspace(
            actor,
            { pageIds },
            { includeAuditPerformance: true },
          );
          if (
            !workspace.auditSearchConsole?.some(
              (report) => report.taskId === input.auditTaskId,
            )
          ) {
            const original = await readAuditPerformanceSummaries(
              actor,
              [input.auditTaskId],
              [input.auditTaskId],
              new Set(
                workspace.pages
                  .filter((page) => workspace.scope.pageIds.includes(page.id))
                  .map((page) => page.url),
              ),
            );
            workspace.auditSearchConsoleRetryTaskIds = [
              ...new Set([
                ...(workspace.auditSearchConsoleRetryTaskIds ?? []),
                ...original.auditSearchConsoleRetryTaskIds,
              ]),
            ];
            workspace.auditSearchConsole = [
              ...(workspace.auditSearchConsole ?? []),
              ...original.auditSearchConsole,
            ];
          }
          return ok(c, workspace);
        }
        return ok(c, await syncProjectSeoStatistics(actor, input));
      } catch (error) {
        if (error instanceof HTTPException) throw error;
        throw unprocessableEntity(
          "The native connection could not provide compatible statistics for the selected pages and period",
        );
      }
    },
    syncStatisticsValidationHook,
  );
  return app;
}
