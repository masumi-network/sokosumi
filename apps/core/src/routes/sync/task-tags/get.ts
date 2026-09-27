import { z } from "@hono/zod-openapi";
import type { Hono } from "hono";
import { getEnv } from "@/config/env";
import { badRequest, forbidden } from "@/helpers/error";
import {
  classifyFixtureTaskTags,
  classifyPendingTaskTags,
} from "@/services/task-tag-classification.service";
import { handleSyncRequest } from "../handler";

const fixtureQuerySchema = z
  .object({
    fixtureTaskId: z.uuid(),
    fixtureOwnerId: z.string().trim().min(1).max(200),
  })
  .strict();

export default function mount(app: Hono) {
  app.get("/task-tags", (c) => {
    const query = c.req.query();
    if (Object.keys(query).length === 0) {
      return handleSyncRequest(
        c,
        "task-tag-classification",
        classifyPendingTaskTags,
      );
    }
    if (Object.values(c.req.queries()).some((values) => values.length !== 1)) {
      throw badRequest("Invalid fixture scope");
    }
    const parsed = fixtureQuerySchema.safeParse(query);
    if (!parsed.success) throw badRequest("Invalid fixture scope");
    if (getEnv().VERCEL_ENV !== "preview") {
      throw forbidden("Fixture scope requires a preview deployment");
    }
    return handleSyncRequest(c, "task-tag-classification", (context) =>
      classifyFixtureTaskTags(context, {
        taskId: parsed.data.fixtureTaskId,
        ownerId: parsed.data.fixtureOwnerId,
      }),
    );
  });
}
