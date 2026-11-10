import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created, empty, ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireProjectAccess } from "@/lib/image-studio/access";
import {
  createStudioConnection,
  MAX_STUDIO_CONNECTION_CREDITS,
  readStudioConnection,
  revokeStudioConnection,
} from "@/lib/image-studio/studio-connection";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { imageStudioProjectParamsSchema } from "@/schemas/project-image-studio.schema";

const path = "/{id}/image-studio/connection";
const tags = ["Projects"];
const request = { params: imageStudioProjectParamsSchema };
const errors = {
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
  404: jsonErrorResponse("Not Found"),
};

const connection = z
  .object({
    url: z.string().url(),
    expiresAt: z.string().datetime().nullable(),
    generationCreditLimit: z.number().int().nonnegative().optional(),
    generationCreditsRemaining: z.number().int().nonnegative().optional(),
  })
  .openapi("StudioConnection");
const issuedConnection = connection
  .extend({ token: z.string(), expiresAt: z.string().datetime() })
  .openapi("IssuedStudioConnection");
const issueRequest = z
  .object({
    generationCreditLimit: z
      .number()
      .int()
      .min(0)
      .max(MAX_STUDIO_CONNECTION_CREDITS)
      .optional(),
  })
  .strict()
  .openapi("CreateStudioConnectionRequest");

const getRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path,
    operationId: "getStudioConnection",
    tags,
    request,
    responses: {
      200: jsonSuccessResponse(connection, "Current Studio connection"),
      ...errors,
    },
  }),
);
const postRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path,
    operationId: "createStudioConnection",
    description:
      "Issue a one-hour connection token for this project. Zero credits makes the token read-only. Replaces any current token belonging to the caller.",
    tags,
    request: {
      ...request,
      body: { content: { "application/json": { schema: issueRequest } } },
    },
    responses: {
      201: jsonSuccessResponse(issuedConnection, "Studio connection created"),
      ...errors,
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);
const deleteRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "delete",
    path,
    operationId: "revokeStudioConnection",
    tags,
    request,
    responses: { 204: { description: "Studio connection revoked" }, ...errors },
  }),
);

async function authorize(
  auth: Parameters<typeof requireInteractiveUserAuthContext>[0],
  workspace: Parameters<typeof requireWorkspaceContext>[0],
  projectId: string,
) {
  const { userId } = requireInteractiveUserAuthContext(auth);
  const { workspaceId } = requireWorkspaceContext(workspace);
  await requireProjectAccess({ userId, workspaceId, projectId });
  return { userId, projectId };
}

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(getRoute, async (c) => {
    const owner = await authorize(
      c.var.authContext,
      c.var.workspaceContext,
      c.req.valid("param").id,
    );
    c.header("Cache-Control", "no-store");
    return ok(c, await readStudioConnection(owner));
  });
  app.openapi(postRoute, async (c) => {
    const owner = await authorize(
      c.var.authContext,
      c.var.workspaceContext,
      c.req.valid("param").id,
    );
    c.header("Cache-Control", "no-store");
    return created(
      c,
      await createStudioConnection(
        owner,
        c.req.valid("json")?.generationCreditLimit,
      ),
    );
  });
  app.openapi(deleteRoute, async (c) => {
    const owner = await authorize(
      c.var.authContext,
      c.var.workspaceContext,
      c.req.valid("param").id,
    );
    await revokeStudioConnection(owner);
    return empty(c);
  });
}
