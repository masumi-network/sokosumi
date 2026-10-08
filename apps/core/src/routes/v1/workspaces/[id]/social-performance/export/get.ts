import { createRoute, z } from "@hono/zod-openapi";
import { forbidden } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import { requireSocialBetaAccess } from "@/helpers/social-beta-access";
import {
  socialPerformanceCsv,
  socialPerformanceExportSheets,
  socialPerformanceXlsx,
} from "@/helpers/social-performance-export";
import { requireSocialPostActor } from "@/helpers/social-post-access";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { organizationProductSeatMiddleware } from "@/middleware/organization-product-seat";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { mapProjectSocialConnectionServiceError } from "@/routes/v1/projects/[id]/social-connections/route-helpers";
import { workspaceSocialPerformanceQuerySchema } from "@/schemas/social-performance.schema";
import { listWorkspaceSocialPerformance } from "@/services/social-performance.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/social-performance/export",
    tags: ["Workspaces"],
    middleware: [organizationProductSeatMiddleware],
    description:
      "Export every matching deduplicated cached post across the active workspace, with all attributed project IDs/names and a project-comparison sheet, with measurement and coverage metadata. CSV is the post table. XLSX also includes definitions, publication-cohort trends, observed follower samples and account metrics. Export does not refresh providers.",
    request: {
      params: z.object({ id: z.uuid() }),
      query: workspaceSocialPerformanceQuerySchema.safeExtend({
        format: z.enum(["csv", "xlsx"]).default("csv"),
      }),
    },
    responses: {
      200: {
        description: "Performance export",
        content: {
          "text/csv": { schema: { type: "string" } },
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
            schema: { type: "string", format: "binary" },
          },
        },
      },
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);
export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    const actor = await requireSocialPostActor(c.var.authContext);
    await requireSocialBetaAccess(actor.userId, prisma);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id } = c.req.valid("param");
    if (id !== workspaceId)
      throw forbidden("Performance is scoped to the active workspace");
    const { format, ...query } = c.req.valid("query");
    try {
      const data = await listWorkspaceSocialPerformance({
        ...query,
        workspaceId,
        includeAllPosts: true,
      });
      const sheets = socialPerformanceExportSheets(data);
      const body =
        format === "csv"
          ? socialPerformanceCsv(sheets[0].rows)
          : new Uint8Array(await socialPerformanceXlsx(sheets)).buffer;
      return c.body(body, 200, {
        "content-type":
          format === "csv"
            ? "text/csv; charset=utf-8"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="workspace-performance-${data.range.publishedFrom.slice(0, 10)}_${data.range.publishedUntil.slice(0, 10)}.${format}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      });
    } catch (error) {
      return mapProjectSocialConnectionServiceError(error);
    }
  });
}
