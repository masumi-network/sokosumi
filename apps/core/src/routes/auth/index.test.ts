import { describe, expect, it, vi } from "vitest";

const authHandlerMock = vi.fn(async () => new Response("ok", { status: 200 }));

vi.mock("@/lib/auth.js", () => ({
  auth: {
    handler: (...args: Parameters<typeof authHandlerMock>) =>
      authHandlerMock(...args),
  },
}));

describe("auth route CORS", () => {
  it("allows cross-origin token exchanges for public OAuth clients", async () => {
    const { default: app } = await import("./index.js");

    const response = await app.request("http://localhost/oauth2/token", {
      method: "OPTIONS",
      headers: {
        Origin: "https://consumer.example.com",
        "Access-Control-Request-Method": "POST",
      },
    });

    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("keeps non-token auth routes first-party only", async () => {
    const { default: app } = await import("./index.js");

    const response = await app.request("http://localhost/session", {
      method: "OPTIONS",
      headers: {
        Origin: "https://consumer.example.com",
        "Access-Control-Request-Method": "GET",
      },
    });

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("still allows first-party auth routes", async () => {
    const { default: app } = await import("./index.js");

    const response = await app.request("http://localhost/session", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.sokosumi.com",
        "Access-Control-Request-Method": "GET",
      },
    });

    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://app.sokosumi.com",
    );
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );
  });
});
