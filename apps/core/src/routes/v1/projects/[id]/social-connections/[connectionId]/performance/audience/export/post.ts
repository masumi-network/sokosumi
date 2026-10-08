import { createRoute, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { badRequest, payloadTooLarge } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import { requireSocialBetaAccess } from "@/helpers/social-beta-access";
import {
  socialPerformanceAudienceExportSheets,
  socialPerformanceCsv,
  socialPerformanceXlsx,
} from "@/helpers/social-performance-export";
import { requireSocialPostActor } from "@/helpers/social-post-access";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { projectSocialConnectionParamsSchema } from "@/schemas/project-social-connection.schema";
import { socialPerformanceAudienceResponseSchema } from "@/schemas/social-performance-research.schema";
import { scopedXConnection } from "@/services/social-performance-research.service";
import { mapProjectSocialConnectionServiceError } from "../../../../route-helpers.js";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const pageSchema = socialPerformanceAudienceResponseSchema.extend({
  contacts: socialPerformanceAudienceResponseSchema.shape.contacts.max(100),
});
const bodySchema = z
  .object({
    format: z.enum(["csv", "xlsx"]),
    pages: z.array(pageSchema).min(1).max(20),
  })
  .strict()
  .superRefine(({ pages }, context) => {
    const first = pages[0];
    if (!first) return;
    pages.forEach((page, index) => {
      if (page.kind !== first.kind || page.postId !== first.postId)
        context.addIssue({
          code: "custom",
          path: ["pages", index],
          message:
            "Export pages must have the same audience kind and selected post",
        });
      const postAudience = page.kind === "likers" || page.kind === "reposters";
      if (postAudience !== (page.postId !== null))
        context.addIssue({
          code: "custom",
          path: ["pages", index, "postId"],
          message:
            "Likers and reposters require a selected cached post; account audiences do not",
        });
      if (page.kind !== "mentions" && page.posts.length > 0)
        context.addIssue({
          code: "custom",
          path: ["pages", index, "posts"],
          message: "Incoming post evidence is available only for mentions",
        });
    });
  })
  .openapi("SocialPerformanceAudienceExportRequest");

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/social-connections/{connectionId}/performance/audience/export",
    tags: ["Projects"],
    description:
      "Export up to 20 already loaded X audience sample pages after checking the selected account and cached own-post scope. Values are submitted client samples, not a new provider fetch or a complete audience report. CSV includes contact rows and page coverage; XLSX adds coverage and incoming public post evidence. Does not persist audience contacts or refetch provider data.",
    request: {
      params: projectSocialConnectionParamsSchema,
      body: {
        required: true,
        content: { "application/json": { schema: bodySchema } },
      },
    },
    responses: {
      200: {
        description: "Loaded audience sample export",
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
      413: jsonErrorResponse("Payload Too Large"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(
  app: Pick<OpenAPIHonoWithAuth, "openapi" | "use">,
) {
  app.use(
    "/:id/social-connections/:connectionId/performance/audience/export",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: () => {
        throw payloadTooLarge(
          `Audience export request must not exceed ${MAX_BODY_BYTES} bytes`,
        );
      },
    }),
  );
  app.openapi(route, async (c) => {
    const actor = await requireSocialPostActor(c.var.authContext);
    await requireSocialBetaAccess(actor.userId, prisma);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, connectionId } = c.req.valid("param");
    const { format, pages } = c.req.valid("json");
    try {
      const selectedPostId = pages[0].postId;
      await scopedXConnection(
        { projectId, workspaceId, connectionId },
        selectedPostId ?? undefined,
      );
      if (
        pages.some((page) =>
          page.posts.some(
            ({ post }) =>
              post.connectionId !== connectionId || post.provider !== "x",
          ),
        )
      )
        throw badRequest(
          "Incoming post evidence must belong to the selected X account sample",
        );
      const sheets = socialPerformanceAudienceExportSheets(connectionId, pages);
      const body =
        format === "csv"
          ? socialPerformanceCsv(sheets[0].rows)
          : new Uint8Array(await socialPerformanceXlsx(sheets)).buffer;
      return c.body(body, 200, {
        "content-type":
          format === "csv"
            ? "text/csv; charset=utf-8"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="audience-${pages[0].kind}-${connectionId}.${format}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      });
    } catch (error) {
      return mapProjectSocialConnectionServiceError(error);
    }
  });
}
