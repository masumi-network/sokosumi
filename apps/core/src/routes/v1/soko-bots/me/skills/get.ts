import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { sokoBotInstalledSkillSchema } from "@/schemas/soko-bot.schema";
import { listInstalledSkills } from "@/services/soko-bot-skills.service";

const listSkillsRoute = createRoute({
  method: "get",
  path: "/me/skills",
  operationId: "listMySokoBotSkills",
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(
      z.array(sokoBotInstalledSkillSchema),
      "Installed skills",
    ),
    401: jsonErrorResponse("Unauthorized"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(listSkillsRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    return ok(
      c,
      z
        .array(sokoBotInstalledSkillSchema)
        .parse(await listInstalledSkills(auth.userId, workspace.workspaceId)),
    );
  });
}
