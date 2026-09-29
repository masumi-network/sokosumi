import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { getImageCatalog } from "@/lib/image-studio/catalog";
import { ensureImageCatalogFresh } from "@/lib/image-studio/fal-catalog-refresh";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { imageStudioCatalogSchema } from "@/schemas/project-image-studio.schema";

/**
 * How long a client may reuse a catalog it already has.
 *
 * Five minutes against a six-hour refresh cycle: the catalog barely moves, and
 * the thing this is protecting against is not staleness but the composer
 * re-downloading a hundred and fifty rows on every mount. `private` because the
 * response is behind a session — a shared cache holding it would be serving one
 * account's authorized response to another.
 */
const CACHE_CONTROL = "private, max-age=300";

const route = createRoute({
  method: "get",
  path: "/catalog",
  description:
    "The image studio model catalog: every model the studio can generate with, what each can do, and fal's published price for each. Not project-scoped — capabilities and prices are the same for every project — and deliberately not part of the polled project state, which clients read every few seconds.",
  tags: ["Image Studio"],
  responses: {
    200: jsonSuccessResponse(
      imageStudioCatalogSchema,
      "The image studio model catalog",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    // Any interactive session may read it. There is nothing here about a project
    // or an account — it is the provider's own published capability and price
    // list — but it is not public either, and an unauthenticated crawler should
    // not be able to make this instance talk to fal.
    requireInteractiveUserAuthContext(c.var.authContext);

    // Cheap and non-blocking: adopts a catalog a sibling instance already
    // refreshed, and otherwise starts a refresh without waiting for it. The
    // committed snapshot answers this request either way.
    await ensureImageCatalogFresh();

    c.header("Cache-Control", CACHE_CONTROL);
    return ok(c, imageStudioCatalogSchema.parse(getImageCatalog()));
  });
}
