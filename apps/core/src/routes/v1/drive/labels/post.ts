import { createRoute, z } from "@hono/zod-openapi";
import { checkFileLabelName } from "@sokosumi/utils";

import { conflict, unprocessableEntity } from "@/helpers/error";
import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { driveFileScopeSchema } from "@/schemas/drive-file.schema";
import {
  createWorkspaceLabelRequestSchema,
  workspaceLabelSchema,
} from "@/schemas/file-resource.schema";

const bodySchema = createWorkspaceLabelRequestSchema.extend({
  scope: driveFileScopeSchema,
  organizationId: z.string().optional(),
});

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/",
    description: [
      "Create a workspace tag or category.",
      "A person creates vocabulary; a model never does. Names are compared",
      "case-folded and NFC-normalized, so one workspace cannot end up with",
      "'Aurora' and 'aurora' as two entries.",
    ].join("\n"),
    tags: ["Drive"],
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: bodySchema } },
      },
    },
    responses: {
      201: jsonSuccessResponse(workspaceLabelSchema, "Label created"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      409: jsonErrorResponse("Conflict"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const body = c.req.valid("json");

    const context = await resolveFileRequestContext({
      authContext,
      scope: body.scope,
      organizationId: body.organizationId,
    });

    const check = checkFileLabelName(body.displayName);
    if (!check.valid) {
      throw unprocessableEntity(`That name is not usable: ${check.problem}`);
    }
    if (body.kind === "CATEGORY" && !body.description) {
      throw unprocessableEntity(
        "A category needs a short description so suggestions have a stable rubric",
      );
    }

    const existing = await prisma.workspaceLabel.findUnique({
      where: {
        workspaceId_kind_normalizedName: {
          workspaceId: context.workspaceId,
          kind: body.kind,
          normalizedName: check.normalizedName,
        },
      },
      select: { id: true },
    });
    if (existing) throw conflict("That name is already in this workspace");

    const label = await prisma.workspaceLabel.create({
      data: {
        workspaceId: context.workspaceId,
        kind: body.kind,
        displayName: check.displayName,
        normalizedName: check.normalizedName,
        description: body.description ?? null,
        createdByUserId: context.actor.userId,
      },
      select: {
        id: true,
        kind: true,
        displayName: true,
        description: true,
        archivedAt: true,
        vocabularyVersion: true,
      },
    });

    return created(
      c,
      workspaceLabelSchema.parse({
        id: label.id,
        kind: label.kind,
        displayName: label.displayName,
        description: label.description,
        archived: false,
        vocabularyVersion: label.vocabularyVersion,
      }),
    );
  });
}
