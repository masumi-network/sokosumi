import { createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import { unprocessableEntity } from "@/helpers/error";
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
              schema: z.union([
                syncProjectSeoStatisticsSchema,
                z.strictObject({ auditTaskId: z.uuid() }),
              ]),
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
  app.openapi(route, async (c) => {
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
  });
  return app;
}
