import { createRoute, z } from "@hono/zod-openapi";
import { composeSystemPrompt, SOKO_BOT_SKILLS } from "@sokosumi/soko-bot";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { hasAdminRole, requireUserAuthContext } from "@/middleware/auth";
import { sokoBotVersionSchema } from "@/schemas/soko-bot.schema";
import {
  listSelectableSokoBotVersions,
  listSokoBotVersions,
} from "@/services/soko-bot-version.service";

const listVersionsRoute = createRoute({
  method: "get",
  path: "/versions",
  operationId: "listSokoBotVersions",
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(z.array(sokoBotVersionSchema), "Agent versions"),
    401: jsonErrorResponse("Unauthorized"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(listVersionsRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    // Authored drafts carry a console-internal system prompt and have not been
    // promoted, so only platform admins — who run the lab — see the full list.
    const versions = hasAdminRole(auth.role)
      ? await listSokoBotVersions()
      : await listSelectableSokoBotVersions(auth.userId);
    return ok(
      c,
      versions.map((version) => ({
        id: version.id,
        name: version.name,
        createdAt: version.createdAt,
        summary: version.summary,
        model: version.model,
        skills: version.skills.map((id) => {
          // An authored version may reference a skills.sh install, which has no
          // built-in definition; show the id rather than failing the listing.
          const skill = SOKO_BOT_SKILLS.find(
            (candidate) => candidate.id === id,
          );
          return {
            id,
            name: skill?.name ?? id,
            description: skill?.description ?? "",
          };
        }),
        capabilities: version.capabilities ? [...version.capabilities] : null,
        inferenceRegion: version.inferenceRegion ?? null,
        systemPrompt: composeSystemPrompt(version),
      })),
    );
  });
}
