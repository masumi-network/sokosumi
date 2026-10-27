import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getEnvMock } = vi.hoisted(() => ({
  getEnvMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
}));

vi.mock("@/config/env.js", () => ({
  getEnv: getEnvMock,
}));

vi.mock("./admin/index.js", () => ({ default: new Hono() }));
vi.mock("./admin/impersonation/index.js", () => ({ default: new Hono() }));
vi.mock("./agents/index.js", () => ({ default: new Hono() }));
vi.mock("./categories/index.js", () => ({ default: new Hono() }));
vi.mock("./chats/index.js", () => ({ default: new Hono() }));
vi.mock("./composio/index.js", () => ({ default: new Hono() }));
vi.mock("./contact-lists/index.js", () => ({ default: new Hono() }));
vi.mock("./contacts/index.js", () => ({ default: new Hono() }));
vi.mock("./checkout/index.js", () => ({ default: new Hono() }));
vi.mock("./coupons/index.js", () => ({ default: new Hono() }));
vi.mock("./coworkers/index.js", () => ({ default: new Hono() }));
vi.mock("./credit-costs/index.js", () => ({ default: new Hono() }));
vi.mock("./developer/index.js", () => ({ default: new Hono() }));
vi.mock("./drive/index.js", () => ({ default: new Hono() }));
vi.mock("./enterprise/index.js", () => ({ default: new Hono() }));
vi.mock("./exports/index.js", () => ({ default: new Hono() }));
vi.mock("./history/index.js", () => ({ default: new Hono() }));
// Stands in like its neighbours: the real router reaches the shared validation
// hook, and through it the auth middleware graph this suite does not build.
vi.mock("./image-studio-agent/index.js", () => ({ default: new Hono() }));
vi.mock("./image-studio/index.js", () => ({ default: new Hono() }));
vi.mock("./invitations/index.js", () => ({ default: new Hono() }));
vi.mock("./jobs/index.js", () => ({ default: new Hono() }));
vi.mock("./notifications/index.js", () => ({ default: new Hono() }));
vi.mock("./organizations/index.js", () => ({ default: new Hono() }));
vi.mock("./organization-invite-links/index.js", () => ({
  default: new Hono(),
}));
vi.mock("./chat-room-invite-links/index.js", () => ({
  default: new Hono(),
}));
vi.mock("./projects/index.js", () => ({ default: new Hono() }));
vi.mock("./tasks/index.js", () => ({ default: new Hono() }));
vi.mock("./tools/index.js", () => ({ default: new Hono() }));
vi.mock("./transactions/index.js", () => ({ default: new Hono() }));
vi.mock("./users/index.js", () => ({ default: new Hono() }));
vi.mock("./products/index.js", () => ({ default: new Hono() }));
vi.mock("./realtime/index.js", () => ({ default: new Hono() }));
vi.mock("./soko-bot-runtime/index.js", () => ({ default: new Hono() }));
vi.mock("./soko-bots/index.js", () => ({ default: new Hono() }));
vi.mock("./vendors/index.js", () => ({ default: new Hono() }));
vi.mock("./webhooks/index.js", () => ({ default: new Hono() }));
vi.mock("./workspaces/index.js", () => ({ default: new Hono() }));

describe("v1 router", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    getEnvMock.mockReturnValue({
      NODE_ENV: "production",
    });
  });

  it("allows x-request-id on cors preflight from the web app", async () => {
    const { default: app } = await import("./index.js");

    const response = await app.request("http://localhost/v1/drive/files", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.sokosumi.com",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "x-request-id,authorization",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://app.sokosumi.com",
    );
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "X-Request-Id",
    );
  });

  it("serves openapi.json with cors headers and a relative v1 server url", async () => {
    const { default: app } = await import("./index.js");

    const response = await app.request("http://localhost/openapi.json", {
      headers: {
        Origin: "https://app.sokosumi.com",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://app.sokosumi.com",
    );
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );
    const body = (await response.json()) as {
      paths?: Record<string, { get?: { security?: [] } }>;
      servers: Array<{ url: string }>;
    };
    expect(body.servers).toEqual([{ url: "/v1" }]);
    expect(body.paths?.["/share/{token}"]?.get?.security).toEqual([]);
    expect(
      body.paths?.["/public/newsletters/{publicSlug}"]?.get?.security,
    ).toEqual([]);
    expect(body.paths?.["/public/newsletter/confirm"]?.get?.security).toEqual(
      [],
    );
  });

  it("allows any origin on signup preflights without credentials", async () => {
    const { default: app } = await import("./index.js");
    const response = await app.request(
      "http://localhost/public/newsletters/weekly/subscribe",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://example.com",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      },
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
      "POST",
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
      "Content-Type",
    );
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("includes public CORS headers on the signup acknowledgment", async () => {
    getEnvMock.mockReturnValue({
      NODE_ENV: "production",
    });
    const { default: app } = await import("./index.js");
    const server = new Hono().route("/v1", app);
    const response = await server.request(
      "http://localhost/v1/public/newsletters/weekly/subscribe",
      {
        method: "POST",
        headers: {
          Origin: "https://example.com",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "reader@example.com",
          website: "https://example.com",
        }),
      },
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "check_your_inbox" });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it.each([
    "/drive/files",
    "/public/newsletters/weekly",
    "/public/newsletters/weekly/subscribe/extra",
    "/public/newsletter/confirm",
    "/public/newsletter/unsubscribe",
  ])("does not widen CORS for %s", async (path) => {
    const { default: app } = await import("./index.js");
    const response = await app.request(`http://localhost${path}`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("registers impersonation before the admin router", () => {
    const src = readFileSync(
      fileURLToPath(new URL("./index.ts", import.meta.url)),
      "utf8",
    );
    const impersonation = src.indexOf(
      'app.route("/admin/impersonation", impersonationRouter)',
    );
    const admin = src.indexOf('app.route("/admin", adminRouter)');
    expect(impersonation).toBeGreaterThan(-1);
    expect(admin).toBeGreaterThan(-1);
    expect(impersonation).toBeLessThan(admin);
  });
});
