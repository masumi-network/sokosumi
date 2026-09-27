import { createRoute } from "@hono/zod-openapi";
import { unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  installSokoBotSkillRequestSchema,
  installSokoBotSkillResponseSchema,
} from "@/schemas/soko-bot.schema";
import {
  installSkill,
  SokoBotSkillError,
} from "@/services/soko-bot-skills.service";

const installSkillRoute = createRoute({
  method: "post",
  path: "/me/skills",
  operationId: "installMySokoBotSkill",
  tags: ["Soko Bots"],
  request: {
    body: {
      content: {
        "application/json": { schema: installSokoBotSkillRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      installSokoBotSkillResponseSchema,
      "Installed skill, or the candidates to choose from",
    ),
    401: jsonErrorResponse("Unauthorized"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(installSkillRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    try {
      const result = await installSkill({
        userId: auth.userId,
        workspaceId: workspace.workspaceId,
        ...c.req.valid("json"),
      });
      return ok(c, installSokoBotSkillResponseSchema.parse(result));
    } catch (error) {
      if (error instanceof SokoBotSkillError) {
        throw unprocessableEntity(error.message);
      }
      throw error;
    }
  });
}
