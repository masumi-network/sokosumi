import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { designMdBrandLook } from "@sokosumi/utils";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { readDesignMdContent } from "@/lib/design-md-blob";
import type { AgentGrantContext } from "@/routes/image-studio-agent/authorize";
import { studioBrandLookSchema } from "@/schemas/studio-brand-kit.schema";
import { parseBrandBrain } from "@/services/brand-brain.service";
import {
  newestMarketingStrategy,
  parseMarketingPlan,
} from "@/services/marketing-strategy.service";

const MAX_TEXT = 180;
const MAX_ITEMS = 3;
const text = z.string().max(MAX_TEXT);
const list = z.array(text).max(MAX_ITEMS);
const route = createRoute({
  method: "get",
  path: "/brand-context",
  tags: ["Image studio agent"],
  operationId: "readStudioAgentBrandContext",
  responses: {
    200: jsonSuccessResponse(
      z
        .object({
          brand: z
            .object({
              positioning: text,
              tone: text,
              audience: list,
              keyMessages: list,
              do: list,
              dont: list,
            })
            .optional(),
          strategy: z
            .object({
              month: z.string(),
              approved: z.boolean(),
              goals: list,
              themes: list,
            })
            .optional(),
          colors: studioBrandLookSchema.shape.colors.optional(),
          fonts: list.optional(),
        })
        .openapi("StudioAgentBrandContext"),
      "Brand and strategy reference copy for the authorized project",
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Project not found"),
    503: jsonErrorResponse("Service unavailable"),
  },
});

function clip(value: string) {
  return value.slice(0, MAX_TEXT);
}

function firstFew(values: string[]) {
  return values.slice(0, MAX_ITEMS).map(clip);
}

export default function mount(
  app: OpenAPIHono<{ Variables: { agentGrant: AgentGrantContext } }>,
) {
  app.openapi(route, async (c) => {
    const { projectId, workspaceId } = c.var.agentGrant;
    const [project, version] = await Promise.all([
      prisma.project.findUniqueOrThrow({
        where: { id: projectId, workspaceId },
        select: {
          brandBrain: { select: { body: true } },
          designMdUrl: true,
          studioBrandLook: true,
        },
      }),
      newestMarketingStrategy(projectId),
    ]);
    const brain = parseBrandBrain(project.brandBrain?.body);
    const plan = parseMarketingPlan(version?.plan);
    const kit = studioBrandLookSchema.safeParse(project.studioBrandLook).data;

    const look =
      kit ??
      designMdBrandLook(
        (project.designMdUrl &&
          (await readDesignMdContent(project.designMdUrl))) ??
          "",
      );
    return ok(c, {
      brand: brain
        ? {
            positioning: clip(brain.reveal?.positioning ?? brain.summary),
            tone: clip(brain.voice.tone),
            audience: firstFew(brain.audience),
            keyMessages: firstFew(brain.voice.examples),
            do: firstFew(brain.voice.do),
            dont: firstFew(brain.voice.dont),
          }
        : undefined,
      strategy: plan
        ? {
            month: plan.month,
            approved: Boolean(version?.approvedAt),
            goals: firstFew(plan.goals),
            themes: firstFew(plan.pillars.map((pillar) => pillar.name)),
          }
        : undefined,
      colors: look.colors.length ? look.colors : undefined,
      fonts: look.fonts.length ? firstFew(look.fonts) : undefined,
    });
  });
}
