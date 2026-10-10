import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse } from "@/helpers/openapi";
import {
  socialAccountStatisticsCsv,
  socialAccountStatisticsExportSheets,
  socialAccountStatisticsXlsx,
} from "@/helpers/social-account-statistics-export";
import { requireSocialBetaAccess } from "@/helpers/social-beta-access";
import { requireSocialPostActor } from "@/helpers/social-post-access";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { projectSocialConnectionProjectParamsSchema } from "@/schemas/project-social-connection.schema";
import { socialAccountStatisticsExportQuerySchema } from "@/schemas/social-account-statistics.schema";
import { exportSocialAccountStatistics } from "@/services/social-account-statistics.service";
import { mapProjectSocialConnectionServiceError } from "../../route-helpers.js";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/social-connections/statistics/export",
    tags: ["Projects"],
    description:
      "Export every matching cached published post as CSV or a spreadsheet. The file uses the same account and publication filters as the statistics page. Export does not refresh providers.",
    request: {
      params: projectSocialConnectionProjectParamsSchema,
      query: socialAccountStatisticsExportQuerySchema,
    },
    responses: {
      200: {
        description: "Statistics export",
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
    const { id: projectId } = c.req.valid("param");
    const { format, publishedFrom, publishedUntil, ...query } =
      c.req.valid("query");
    try {
      const data = await exportSocialAccountStatistics({
        projectId,
        workspaceId,
        ...query,
        publishedFrom: publishedFrom ? new Date(publishedFrom) : undefined,
        publishedUntil: publishedUntil ? new Date(publishedUntil) : undefined,
      });
      const sheets = socialAccountStatisticsExportSheets(data);
      const from = (publishedFrom ?? "all").toString().slice(0, 10);
      const until = (publishedUntil ?? "latest").toString().slice(0, 10);
      const body =
        format === "csv"
          ? socialAccountStatisticsCsv(sheets[0].rows)
          : new Uint8Array(await socialAccountStatisticsXlsx(sheets)).buffer;
      return c.body(body, 200, {
        "content-type":
          format === "csv"
            ? "text/csv; charset=utf-8"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="performance-${from}_${until}.${format}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      });
    } catch (error) {
      return mapProjectSocialConnectionServiceError(error);
    }
  });
}
