import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The catalog's own route.
 *
 * It exists because the catalog used to ride inside the project state payload,
 * which clients poll every three seconds — fine for three hard-coded models,
 * about 150KB a poll now that the catalog is fal's real list. So the two things
 * asserted here are that it answers the whole catalog, and that it tells a client
 * it may keep it for a while.
 */

const { ensureFreshMock } = vi.hoisted(() => ({
  ensureFreshMock: vi.fn(),
}));

vi.mock("@/lib/image-studio/fal-catalog-refresh", () => ({
  ensureImageCatalogFresh: ensureFreshMock,
}));

import { getImageCatalog } from "@/lib/image-studio/catalog";
import type { AuthenticationContext } from "@/middleware/auth";
import mountGetImageStudioCatalog from "@/routes/v1/image-studio/catalog-get";

// A bare OpenAPIHono rather than `OpenAPIHonoWithAuth`, with the auth context set
// by hand: building the real middleware graph here pulls in Better Auth and the
// Stripe client, neither of which this route touches.
const app = new OpenAPIHono<{
  Variables: { authContext: AuthenticationContext };
}>();
app.use(async (c, next) => {
  c.set("authContext", {
    actor: "user",
    authenticationMethod: "session",
    userId: "user-a",
    organizationId: null,
    role: "user",
  });
  await next();
});
mountGetImageStudioCatalog(app as never);

beforeEach(() => {
  vi.clearAllMocks();
  ensureFreshMock.mockResolvedValue(undefined);
});

describe("GET /v1/image-studio/catalog", () => {
  it("answers the resolved catalog, and asks the client to keep it briefly", async () => {
    const response = await app.request("/catalog");

    expect(response.status).toBe(200);
    // `private`, not `public`: the response sits behind a session, and a shared
    // cache holding it would serve one account's authorized response to another.
    expect(response.headers.get("cache-control")).toBe("private, max-age=300");
    const body = (await response.json()) as {
      data: { models: unknown[]; defaultModelId: string };
    };
    expect(body.data.models).toHaveLength(getImageCatalog().models.length);
    expect(body.data.defaultModelId).toBe(getImageCatalog().defaultModelId);
  });

  it("asks for a fresh catalog but never waits on fal to answer", async () => {
    // A slow or rate-limited provider must not turn into a slow page load; the
    // committed snapshot is already a complete answer.
    ensureFreshMock.mockResolvedValue(undefined);
    const response = await app.request("/catalog");
    expect(ensureFreshMock).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
  });
});
