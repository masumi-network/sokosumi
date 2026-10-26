import { createRoute } from "@hono/zod-openapi";
import { socialPostTextLimit } from "@sokosumi/utils";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { requireSocialBetaAccess } from "@/helpers/social-beta-access";
import { requireSocialPostActor } from "@/helpers/social-post-access";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  projectSocialConnectionParamsSchema,
  projectSocialConnectionSubscriptionSchema,
  projectSocialProviderSchema,
} from "@/schemas/project-social-connection.schema";
import { resolveXSubscriptionType } from "@/services/x-subscription-tier.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/social-connections/{connectionId}/subscription",
    tags: ["Projects"],
    description:
      "Refresh an X account's subscription tier and text limit, falling back to the stored tier when X is unavailable.",
    request: { params: projectSocialConnectionParamsSchema },
    responses: {
      200: jsonSuccessResponse(
        projectSocialConnectionSubscriptionSchema,
        "Account subscription and text limit",
      ),
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
    const { id: projectId, connectionId } = c.req.valid("param");
    const connection = await prisma.projectSocialConnection.findFirst({
      where: {
        id: connectionId,
        projectId,
        project: { workspaceId },
        status: { not: "disconnected" },
      },
      select: {
        id: true,
        projectId: true,
        provider: true,
        composioConnectedAccountId: true,
        subscriptionType: true,
      },
    });
    if (!connection) throw notFound("Project social connection not found");
    const subscriptionType = await resolveXSubscriptionType(connection);
    return ok(
      c,
      projectSocialConnectionSubscriptionSchema.parse({
        subscriptionType,
        textLimit: socialPostTextLimit(
          projectSocialProviderSchema.parse(connection.provider),
          subscriptionType,
        ),
      }),
    );
  });
}
