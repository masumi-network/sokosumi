import { createRoute, z } from "@hono/zod-openapi";
import { checkFileLabelName } from "@sokosumi/utils";

import { conflict, notFound, unprocessableEntity } from "@/helpers/error";
import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { driveFileScopeSchema } from "@/schemas/drive-file.schema";
import {
  updateWorkspaceLabelRequestSchema,
  workspaceLabelSchema,
} from "@/schemas/file-resource.schema";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({ param: { name: "id", in: "path" } }),
});

const bodySchema = updateWorkspaceLabelRequestSchema.extend({
  scope: driveFileScopeSchema,
  organizationId: z.string().optional(),
});

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "patch",
    path: "/{id}",
    description: [
      "Rename, describe, archive or merge a vocabulary entry.",
      "",
      "A rename keeps the id, so saved filters and existing assignments keep",
      "working. A merge records a redirect from the retired id and deduplicates",
      "assignments; it is an administrative action, never something a model does.",
    ].join("\n"),
    tags: ["Drive"],
    request: {
      params: paramsSchema,
      body: {
        required: true,
        content: { "application/json": { schema: bodySchema } },
      },
    },
    responses: {
      200: jsonSuccessResponse(workspaceLabelSchema, "Label updated"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const context = await resolveFileRequestContext({
      authContext,
      scope: body.scope,
      organizationId: body.organizationId,
    });

    const label = await prisma.workspaceLabel.findFirst({
      where: { id, workspaceId: context.workspaceId },
      select: {
        id: true,
        kind: true,
        displayName: true,
        normalizedName: true,
        aliases: true,
      },
    });
    if (!label) throw notFound("Label not found");

    if (body.mergeIntoLabelId) {
      const target = await prisma.workspaceLabel.findFirst({
        where: {
          id: body.mergeIntoLabelId,
          workspaceId: context.workspaceId,
          kind: label.kind,
        },
        select: { id: true },
      });
      if (!target) throw unprocessableEntity("Merge target not found");
      if (target.id === label.id) {
        throw unprocessableEntity("A label cannot merge into itself");
      }

      await prisma.$transaction(async (tx) => {
        // Move assignments that the target does not already have, then drop
        // the duplicates, so a merge never doubles a file's tag list.
        const assignments = await tx.fileLabel.findMany({
          where: { labelId: label.id },
          select: { id: true, resourceId: true, evidenceScopeId: true },
        });
        for (const assignment of assignments) {
          const duplicate = await tx.fileLabel.findUnique({
            where: {
              resourceId_labelId_evidenceScopeId: {
                resourceId: assignment.resourceId,
                labelId: target.id,
                evidenceScopeId: assignment.evidenceScopeId,
              },
            },
            select: { id: true },
          });
          if (duplicate) {
            await tx.fileLabel.delete({ where: { id: assignment.id } });
          } else {
            await tx.fileLabel.update({
              where: { id: assignment.id },
              data: { labelId: target.id },
            });
          }
        }

        await tx.workspaceLabel.update({
          where: { id: label.id },
          data: {
            mergedIntoId: target.id,
            archivedAt: new Date(),
            vocabularyVersion: { increment: 1 },
          },
        });
        await tx.workspaceLabel.update({
          where: { id: target.id },
          data: {
            aliases: { push: label.normalizedName },
            vocabularyVersion: { increment: 1 },
          },
        });
      });
    }

    const rename = body.displayName
      ? checkFileLabelName(body.displayName)
      : null;
    if (rename && !rename.valid) {
      throw unprocessableEntity(`That name is not usable: ${rename.problem}`);
    }

    if (rename && rename.normalizedName !== label.normalizedName) {
      const clash = await prisma.workspaceLabel.findUnique({
        where: {
          workspaceId_kind_normalizedName: {
            workspaceId: context.workspaceId,
            kind: label.kind,
            normalizedName: rename.normalizedName,
          },
        },
        select: { id: true },
      });
      if (clash) throw conflict("That name is already in this workspace");
    }

    const updated = await prisma.workspaceLabel.update({
      where: { id: label.id },
      data: {
        ...(rename
          ? {
              displayName: rename.displayName,
              normalizedName: rename.normalizedName,
              // The old name keeps resolving so a saved filter survives.
              aliases: { push: label.normalizedName },
            }
          : {}),
        ...(body.description !== undefined
          ? { description: body.description ?? null }
          : {}),
        ...(body.archived !== undefined
          ? { archivedAt: body.archived ? new Date() : null }
          : {}),
        vocabularyVersion: { increment: 1 },
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

    return ok(
      c,
      workspaceLabelSchema.parse({
        id: updated.id,
        kind: updated.kind,
        displayName: updated.displayName,
        description: updated.description,
        archived: updated.archivedAt !== null,
        vocabularyVersion: updated.vocabularyVersion,
      }),
    );
  });
}
