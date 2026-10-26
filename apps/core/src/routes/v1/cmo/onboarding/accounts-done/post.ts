import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { cmoOverviewSchema } from "@/schemas/cmo.schema";
import { finishCmoAccountsStep } from "@/services/cmo.service";

import { requireOverview, rethrow } from "../../helpers";

const route = createRoute({
  method: "post",
  path: "/onboarding/accounts-done",
  operationId: "finishCmoAccountsStep",
  tags: ["CMO"],
  description:
    "The founder connected or skipped the Accounts step: onboarding resumes on the plan.",
  responses: {
    200: jsonSuccessResponse(cmoOverviewSchema, "Accounts step done"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
    409: jsonErrorResponse("The strategy is not approved yet"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    await finishCmoAccountsStep(userId).catch(rethrow);
    return ok(c, await requireOverview(userId));
  });
}
