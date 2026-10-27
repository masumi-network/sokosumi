import { createRoute, z } from "@hono/zod-openapi";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { projectPostingInstructionsSchema } from "@/schemas/project.schema";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    }),
});

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/posting-instructions",
    description:
      "Get a project's social posting instructions: markdown to read and follow before drafting a social post. Null when none are set. Separate from project memory (CONTEXT.md) and DESIGN.md. Session users and coworker keys bound to a user with access to the project's workspace.",
    tags: ["Projects"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(
        projectPostingInstructionsSchema,
        "Project posting instructions",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    await requireAuthorizedUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id } = c.req.valid("param");

    const project = await prisma.project.findFirst({
      where: { id, workspaceId: workspaceContext.workspaceId },
      select: { postingInstructionsMd: true },
    });
    if (!project) {
      throw notFound("Project not found");
    }

    return ok(
      c,
      projectPostingInstructionsSchema.parse({
        postingInstructionsMd: project.postingInstructionsMd,
      }),
    );
  });
}
