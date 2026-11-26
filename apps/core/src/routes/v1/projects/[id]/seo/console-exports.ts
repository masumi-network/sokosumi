import { createRoute, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requireSeoRouteActor } from "@/helpers/project-seo-access";
import { ok } from "@/helpers/response";
import {
  OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import {
  consoleExportInput,
  consoleExportSummary,
} from "@/schemas/seo-console-export.schema";
import { consoleExports } from "@/services/seo-console-export";

export function createSeoConsoleExportsRouter(ownerKind: "project" | "audit") {
  const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });
  const path = "/{taskId}";
  app.use(
    "*",
    bodyLimit({
      maxSize: 600_000,
      onError: () => {
        throw unprocessableEntity("The export request is too large");
      },
    }),
  );
  const tags = ["SEO"];
  const params = z.object({ id: z.uuid(), taskId: z.uuid() });
  const responses = {
    200: jsonSuccessResponse(
      z.array(consoleExportSummary),
      "Owner-private Search Console export samples",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Audit not found"),
    409: jsonErrorResponse("Conflict or CMO Project is read-only"),
    422: jsonErrorResponse("Invalid export"),
  };
  app.openapi(
    withOrganizationSlugHeaderParameter(
      createRoute({
        method: "get",
        path,
        tags,
        operationId:
          ownerKind === "audit"
            ? "getAuditConsoleExports"
            : "getProjectConsoleExports",
        request: { params },
        responses,
      }),
    ),
    async (c) => {
      const { id, taskId } = c.req.valid("param");
      c.header("Cache-Control", "private, no-store");
      return ok(
        c,
        await consoleExports(
          requireSeoRouteActor(c.var, { kind: ownerKind, id }),
          taskId,
        ),
      );
    },
  );
  app.openapi(
    withOrganizationSlugHeaderParameter(
      createRoute({
        method: "post",
        path,
        tags,
        operationId:
          ownerKind === "audit"
            ? "importAuditConsoleExport"
            : "importProjectConsoleExport",
        request: {
          params,
          body: {
            required: true,
            content: { "application/json": { schema: consoleExportInput } },
          },
        },
        responses,
      }),
    ),
    async (c) => {
      const { id, taskId } = c.req.valid("param");
      c.header("Cache-Control", "private, no-store");
      return ok(
        c,
        await consoleExports(
          requireSeoRouteActor(c.var, { kind: ownerKind, id }),
          taskId,
          c.req.valid("json"),
        ),
      );
    },
  );
  return app;
}
