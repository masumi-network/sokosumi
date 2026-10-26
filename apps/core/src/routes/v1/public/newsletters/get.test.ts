import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { EnvVariables } from "@/lib/hono";
import { NEWSLETTER } from "@/test/newsletter";

import router from "./index";

const m = vi.hoisted(() => ({
  enabled: true,
  newsletter: vi.fn(),
  subscriber: vi.fn(),
}));
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), NEWSLETTER_ENABLED: m.enabled }),
  };
});
vi.mock("@/lib/db/prisma", () => ({
  default: {
    newsletter: { findUnique: m.newsletter },
    newsletterSubscriber: { findMany: m.subscriber },
  },
}));

function app() {
  const app = new OpenAPIHono<EnvVariables>();
  app.use("*", async (c, next) => {
    c.set("requestId", "newsletter_test");
    await next();
  });
  app.route("/v1/public/newsletters", router);
  app.onError(errorHandler);
  return app;
}
const URL = `http://localhost/v1/public/newsletters/${NEWSLETTER.publicSlug}`;

beforeEach(() => {
  vi.resetAllMocks();
  m.enabled = true;
  m.newsletter.mockResolvedValue({
    ...NEWSLETTER,
    brand: { primaryColor: "#123456" },
    subscribers: [{ email: "reader@example.com" }],
  });
});

describe("public newsletter info", () => {
  it("returns only name, senderName and brand without authentication or subscriber data", async () => {
    const response = await app().request(URL);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({
      name: "Weekly News",
      senderName: "Ada",
      brand: { primaryColor: "#123456" },
    });
    expect(m.newsletter).toHaveBeenCalledExactlyOnceWith({
      where: {
        publicSlug: NEWSLETTER.publicSlug,
        project: { workspace: { organization: { slug: "utxo" } } },
      },
      select: { name: true, senderName: true, brand: true },
    });
    expect(m.subscriber).not.toHaveBeenCalled();
  });

  it("returns 404 when missing", async () => {
    m.newsletter.mockResolvedValue(null);
    expect((await app().request(URL)).status).toBe(404);
  });

  it("hides newsletter metadata outside the project's beta organization", async () => {
    m.newsletter.mockImplementation(async ({ where }) =>
      where.project?.workspace?.organization?.slug === "utxo"
        ? null
        : NEWSLETTER,
    );
    expect((await app().request(URL)).status).toBe(404);
    expect(m.subscriber).not.toHaveBeenCalled();
  });

  it("returns 404 without data access when disabled", async () => {
    m.enabled = false;
    expect((await app().request(URL)).status).toBe(404);
    expect(m.newsletter).not.toHaveBeenCalled();
  });
});
