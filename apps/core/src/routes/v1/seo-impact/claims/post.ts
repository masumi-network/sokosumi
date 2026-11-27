import { createRoute, z } from "@hono/zod-openapi";

import { forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { isGlobalSeoExecutor } from "@/lib/seo/analysis-executor-config";
import {
  type AuthenticationContext,
  requireCoworkerAuthContext,
} from "@/middleware/auth";
import {
  seoImpactClaimSchema,
  seoImpactResultSchema,
  seoImpactVerdictReceiptSchema,
} from "@/schemas/seo-impact-worker.schema";
import {
  claimSeoImpact,
  recordSeoImpactVerdict,
} from "@/services/seo-impact-claims";

const errors = {
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
};

const claimRoute = createRoute({
  method: "post",
  path: "/claims",
  tags: ["SEO"],
  description:
    "The global SEO worker claims the oldest page change that is ready for its impact verdict, with the Search Console series Core read for it. Answers null when no change is ready.",
  responses: {
    200: jsonSuccessResponse(seoImpactClaimSchema, "A claim, or null"),
    ...errors,
  },
});

const verdictRoute = createRoute({
  method: "post",
  path: "/claims/{claimId}/verdict",
  tags: ["SEO"],
  description:
    "The global SEO worker saves its impact result for its claim. A claim past claimedUntil still saves until a later claim takes the change. The same result again gets the same answer.",
  request: {
    params: z.object({ claimId: z.uuid() }),
    body: {
      required: true,
      content: { "application/json": { schema: seoImpactResultSchema } },
    },
  },
  responses: {
    200: jsonSuccessResponse(seoImpactVerdictReceiptSchema, "Result saved"),
    ...errors,
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

/** Only the configured global SEO worker, on a direct call. */
function requireSeoImpactWorker(authContext: AuthenticationContext) {
  if (!isGlobalSeoExecutor(requireCoworkerAuthContext(authContext)))
    throw forbidden("Only the global SEO worker can use the impact queue.");
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(claimRoute, async (c) => {
    requireSeoImpactWorker(c.var.authContext);
    c.header("Cache-Control", "no-store");
    return ok(c, await claimSeoImpact());
  });
  app.openapi(verdictRoute, async (c) => {
    requireSeoImpactWorker(c.var.authContext);
    c.header("Cache-Control", "no-store");
    return ok(
      c,
      await recordSeoImpactVerdict(
        c.req.valid("param").claimId,
        c.req.valid("json"),
      ),
    );
  });
}
