import { createRoute } from "@hono/zod-openapi";
import { SOKO_BOT_CAPABILITIES, SOKO_BOT_SKILLS } from "@sokosumi/soko-bot";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import { sokoBotVersionListSchema } from "@/schemas/soko-bot.schema";
import {
  getDefaultSokoBotVersionId,
  listSokoBotVersions,
} from "@/services/soko-bot-version.service";
import { versionDetail } from "../helpers.js";

// ---------------------------------------------------------------------------
// Version authoring
//
// Built-in versions stay immutable in code; these endpoints manage the
// database-backed ones and the promoted default. Admin-only: the system prompt
// carries the operating contract, so editing it changes how every new bot
// behaves.
// ---------------------------------------------------------------------------

const listVersionsRoute = createRoute({
  method: "get",
  path: "/versions",
  operationId: "listAdminSokoBotVersions",
  tags: ["Admin"],
  responses: {
    200: jsonSuccessResponse(
      sokoBotVersionListSchema,
      "Built-in and authored versions, with the tools and skills available",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(listVersionsRoute, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const [versions, defaultVersionId] = await Promise.all([
      listSokoBotVersions(),
      getDefaultSokoBotVersionId(),
    ]);
    return ok(
      c,
      sokoBotVersionListSchema.parse({
        defaultVersionId,
        versions: versions.map((version) =>
          versionDetail(version, version.authored, defaultVersionId),
        ),
        availableCapabilities: [...SOKO_BOT_CAPABILITIES],
        availableSkills: SOKO_BOT_SKILLS.map((skill) => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          installed: false,
        })),
      }),
    );
  });
}
