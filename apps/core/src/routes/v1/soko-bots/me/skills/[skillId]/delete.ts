import { createRoute, z } from "@hono/zod-openapi";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  removeInstalledSkill,
  SokoBotSkillError,
} from "@/services/soko-bot-skills.service";

const removeSkillRoute = createRoute({
  method: "delete",
  path: "/me/skills/{skillId}",
  operationId: "removeMySokoBotSkill",
  tags: ["Soko Bots"],
  request: {
    params: z.object({ skillId: z.string().uuid() }),
  },
  responses: {
    200: jsonSuccessResponse(z.object({ removed: z.boolean() }), "Removed"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(removeSkillRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    try {
      await removeInstalledSkill(auth.userId, c.req.valid("param").skillId);
      return ok(c, { removed: true });
    } catch (error) {
      if (error instanceof SokoBotSkillError) throw notFound(error.message);
      throw error;
    }
  });
}
