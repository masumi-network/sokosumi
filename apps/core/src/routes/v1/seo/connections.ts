import { createRoute } from "@hono/zod-openapi";
import {
  ComposioApiError,
  ComposioConfigError,
} from "@/clients/composio.client";
import { isFirstPartyAppUrl } from "@/config/cors-allow-origin";
import {
  integrationNotConfigured,
  serviceUnavailable,
  unprocessableEntity,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireFirstPartyUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  connectSeoConnectionResponseSchema,
  connectSeoConnectionSchema,
  disconnectSeoConnectionSchema,
  finalizeSeoConnectionSchema,
  seoConnectionParamsSchema,
  seoConnectionStatusSchema,
} from "@/schemas/seo-connection.schema";
import { SokoBotIntegrationError } from "@/services/composio-integration-tools.service";
import {
  connectSeoConnection,
  disconnectSeoConnection,
  finalizeSeoConnection,
} from "@/services/seo-connection-oauth.service";
import { getSeoConnection } from "@/services/seo-connections.service";

function mapSeoConnectionError(error: unknown): never {
  if (
    error instanceof ComposioConfigError ||
    (error instanceof SokoBotIntegrationError &&
      error.kind === "NOT_CONFIGURED")
  )
    throw integrationNotConfigured();
  if (
    error instanceof ComposioApiError ||
    error instanceof SokoBotIntegrationError
  )
    throw serviceUnavailable("SEO connections are temporarily unavailable");
  throw error;
}

const errors = {
  400: jsonErrorResponse("Bad Request"),
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
  404: jsonErrorResponse("Not Found"),
  409: jsonErrorResponse("Conflict"),
  422: jsonErrorResponse("Unprocessable Entity"),
  503: jsonErrorResponse("Service Unavailable"),
};

export function mountSeoConnectionRoutes(app: OpenAPIHonoWithAuth) {
  const getRoute = withOrganizationSlugHeaderParameter(
    createRoute({
      method: "get",
      path: "/connections/{provider}",
      operationId: "getSeoConnection",
      tags: ["SEO"],
      request: { params: seoConnectionParamsSchema },
      responses: {
        ...errors,
        200: jsonSuccessResponse(
          seoConnectionStatusSchema,
          "Current person's SEO connection",
        ),
      },
    }),
  );
  const connectRoute = withOrganizationSlugHeaderParameter(
    createRoute({
      method: "post",
      path: "/connections/{provider}",
      operationId: "connectSeoConnection",
      tags: ["SEO"],
      request: {
        params: seoConnectionParamsSchema,
        body: {
          required: true,
          content: {
            "application/json": { schema: connectSeoConnectionSchema },
          },
        },
      },
      responses: {
        ...errors,
        200: jsonSuccessResponse(
          connectSeoConnectionResponseSchema,
          "Explicit SEO provider consent",
        ),
      },
    }),
  );
  const finalizeRoute = withOrganizationSlugHeaderParameter(
    createRoute({
      method: "post",
      path: "/connections/{provider}/finalize",
      operationId: "finalizeSeoConnection",
      tags: ["SEO"],
      request: {
        params: seoConnectionParamsSchema,
        body: {
          required: true,
          content: {
            "application/json": { schema: finalizeSeoConnectionSchema },
          },
        },
      },
      responses: {
        ...errors,
        200: jsonSuccessResponse(
          seoConnectionStatusSchema,
          "Verified SEO provider connection",
        ),
      },
    }),
  );
  const disconnectRoute = withOrganizationSlugHeaderParameter(
    createRoute({
      method: "delete",
      path: "/connections/{provider}",
      operationId: "disconnectSeoConnection",
      tags: ["SEO"],
      request: { params: seoConnectionParamsSchema },
      responses: {
        ...errors,
        200: jsonSuccessResponse(
          disconnectSeoConnectionSchema,
          "SEO provider disconnected",
        ),
      },
    }),
  );
  app.openapi(getRoute, async (c) => {
    const user = requireFirstPartyUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    return ok(
      c,
      await getSeoConnection(
        { userId: user.userId, workspaceId: workspace.workspaceId },
        c.req.valid("param").provider,
      ),
    );
  });
  app.openapi(connectRoute, async (c) => {
    const user = requireFirstPartyUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const { callbackUrl } = c.req.valid("json");
    if (callbackUrl && !isFirstPartyAppUrl(callbackUrl))
      throw unprocessableEntity("Unknown return address");
    try {
      return ok(
        c,
        await connectSeoConnection(
          { userId: user.userId, workspaceId: workspace.workspaceId },
          c.req.valid("param").provider,
          callbackUrl,
        ),
      );
    } catch (error) {
      mapSeoConnectionError(error);
    }
  });
  app.openapi(finalizeRoute, async (c) => {
    const user = requireFirstPartyUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    try {
      return ok(
        c,
        await finalizeSeoConnection(
          { userId: user.userId, workspaceId: workspace.workspaceId },
          c.req.valid("param").provider,
          c.req.valid("json").connectionId,
        ),
      );
    } catch (error) {
      mapSeoConnectionError(error);
    }
  });
  app.openapi(disconnectRoute, async (c) => {
    const user = requireFirstPartyUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    try {
      return ok(
        c,
        await disconnectSeoConnection(
          { userId: user.userId, workspaceId: workspace.workspaceId },
          c.req.valid("param").provider,
        ),
      );
    } catch (error) {
      mapSeoConnectionError(error);
    }
  });
}
