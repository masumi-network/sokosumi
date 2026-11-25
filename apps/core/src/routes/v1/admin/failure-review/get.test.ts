import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono.js";
import type { AuthenticationContext } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

const CODEPAT = "01a0abc4-784e-7261-ab22-0ae0706f6fa3";
const OTHER_COWORKER = "01a0abc4-784e-7261-ab22-0ae0706f6fa4";

const m = vi.hoisted(() => ({
  authContext: { current: null as unknown },
  listed: [] as string[],
  readFailureReview: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<unknown>,
    ) => {
      c.set("isAuthenticated", true);
      c.set("authContext", m.authContext.current);
      return await next();
    },
  };
});

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      FAILURE_REVIEW_COWORKER_IDS: m.listed,
    }),
  };
});

vi.mock("@/services/failure-review.service", () => ({
  readFailureReview: m.readFailureReview,
}));

const { default: failureReviewRouter } = await import("./index.js");

const EMPTY = {
  turns: [],
  mentions: [],
  replyChecks: [],
  toolCalls: [],
  posting: [],
  media: [],
  schedules: [],
  evals: [],
};

/** The v1 order: this router before `/admin`, whose guard admits admins only. */
function createApp(authContext: AuthenticationContext) {
  m.authContext.current = authContext;
  const admin = new OpenAPIHonoWithAuth();
  admin.use(
    "*",
    createMiddleware(async (c, next) => {
      requireAdminAuthContext(c.var.authContext);
      await next();
    }),
  );
  admin.get("/users", (c) => c.text("admin only"));
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.route("/admin/failure-review", failureReviewRouter);
  app.route("/admin", admin);
  return app;
}

const user = (role: string): AuthenticationContext => ({
  actor: "user",
  userId: "user_1",
  organizationId: null,
  role,
});

const coworker = (
  coworkerId: string,
  context?: { userId: string; organizationId: string | null },
): AuthenticationContext => ({
  actor: "coworker",
  coworkerId,
  vendorId: TEST_VENDOR_ID,
  ...(context ? { context } : {}),
});

describe("GET /admin/failure-review", () => {
  beforeEach(() => {
    m.listed = [CODEPAT];
    m.readFailureReview.mockImplementation(
      async (since: Date, until: Date) => ({
        window: {
          since: since.toISOString(),
          until: until.toISOString(),
          previousSince: since.toISOString(),
        },
        sections: EMPTY,
        cmoMonths: [],
        notCovered: [],
      }),
    );
  });

  it("answers a platform admin, defaulting to the last 7 days", async () => {
    const response = await createApp(user("admin")).request(
      "/admin/failure-review",
    );
    expect(response.status).toBe(200);
    const [since, until] = m.readFailureReview.mock.calls[0] as [Date, Date];
    expect(until.getTime() - since.getTime()).toBe(7 * 24 * 60 * 60 * 1_000);
  });

  it("denies a member who is not a platform admin", async () => {
    const response = await createApp(user("user")).request(
      "/admin/failure-review",
    );
    expect(response.status).toBe(403);
    expect(m.readFailureReview).not.toHaveBeenCalled();
  });

  it("lets a listed coworker's own key read it, and nothing else admin", async () => {
    const app = createApp(coworker(CODEPAT));
    expect((await app.request("/admin/failure-review")).status).toBe(200);
    expect((await app.request("/admin/users")).status).toBe(403);
  });

  it("denies a coworker that is not listed", async () => {
    const response = await createApp(coworker(OTHER_COWORKER)).request(
      "/admin/failure-review",
    );
    expect(response.status).toBe(403);
    expect(m.readFailureReview).not.toHaveBeenCalled();
  });

  it("denies a listed coworker acting for a user", async () => {
    const response = await createApp(
      coworker(CODEPAT, { userId: "user_1", organizationId: null }),
    ).request("/admin/failure-review");
    expect(response.status).toBe(403);
  });

  it("passes the window and rejects one longer than 31 days", async () => {
    const app = createApp(user("admin"));
    const ok = await app.request(
      "/admin/failure-review?since=2026-11-16T00:00:00.000Z&until=2026-11-23T00:00:00.000Z",
    );
    expect(ok.status).toBe(200);
    expect(m.readFailureReview).toHaveBeenCalledWith(
      new Date("2026-11-16T00:00:00.000Z"),
      new Date("2026-11-23T00:00:00.000Z"),
    );
    const long = await app.request(
      "/admin/failure-review?since=2026-09-01T00:00:00.000Z&until=2026-11-23T00:00:00.000Z",
    );
    expect(long.status).toBe(422);
    const backwards = await app.request(
      "/admin/failure-review?since=2026-11-23T00:00:00.000Z&until=2026-11-16T00:00:00.000Z",
    );
    expect(backwards.status).toBe(422);
  });
});
