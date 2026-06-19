import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchCoreAuthMock = vi.fn();
const getCoreAuthBaseUrlMock = vi.fn();

vi.mock("@/lib/auth/auth.server.client", () => ({
  fetchCoreAuth: (...args: unknown[]) => fetchCoreAuthMock(...args),
  getCoreAuthBaseUrl: () => getCoreAuthBaseUrlMock(),
}));

describe("/api/core-auth proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCoreAuthBaseUrlMock.mockReturnValue("https://core.example.com/auth");
    fetchCoreAuthMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": "12",
        },
      }),
    );
  });

  it("proxies auth requests to Core with path, query, body, and safe headers", async () => {
    const { POST } = await import("../route");
    const request = new NextRequest(
      "https://web.example.com/api/core-auth/sign-in/email?redirect=false",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: "andreas@example.com" }),
      },
    );

    const response = await POST(request, {
      params: Promise.resolve({ path: ["sign-in", "email"] }),
    });

    expect(fetchCoreAuthMock).toHaveBeenCalledWith(
      "https://core.example.com/auth/sign-in/email?redirect=false",
      expect.objectContaining({
        method: "POST",
        headers: expect.any(Headers),
        body: expect.any(ArrayBuffer),
      }),
    );

    const [, init] = fetchCoreAuthMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).get("accept")).toBe("application/json");
    expect((init.headers as Headers).get("content-type")).toBe(
      "application/json",
    );
    expect(await new Response(init.body).json()).toEqual({
      email: "andreas@example.com",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.has("content-length")).toBe(false);
  });
});
