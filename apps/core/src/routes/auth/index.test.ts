import { describe, expect, it, vi } from "vitest";

const authHandlerMock = vi.fn(async () => new Response("ok", { status: 200 }));

vi.mock("@/lib/auth.js", () => ({
  auth: {
    handler: (...args: Parameters<typeof authHandlerMock>) =>
      authHandlerMock(...args),
  },
}));

describe("auth route CORS", () => {
  it("allows cross-origin oauth2 endpoint preflights", async () => {
    const { default: app } = await import("./index.js");

    const response = await app.request("http://localhost/auth/oauth2/token", {
      method: "OPTIONS",
      headers: {
        Origin: "https://consumer.example.com",
        "Access-Control-Request-Method": "POST",
      },
    });

    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("allows other oauth2 routes cross-origin as well", async () => {
    const { default: app } = await import("./index.js");

    const response = await app.request(
      "http://localhost/auth/oauth2/introspect",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://consumer.example.com",
          "Access-Control-Request-Method": "POST",
        },
      },
    );

    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("keeps non-oauth auth routes first-party only", async () => {
    const { default: app } = await import("./index.js");

    const response = await app.request("http://localhost/auth/session", {
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

    const response = await app.request("http://localhost/auth/session", {
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
