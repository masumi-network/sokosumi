import { beforeEach, describe, expect, it, vi } from "vitest";
const getSessionMock = vi.fn();
const headersMock = vi.fn();
const captureExceptionMock = vi.fn();
const fetchMock = vi.fn();

vi.mock("next/headers", () => ({
  headers: () => headersMock(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

vi.mock("@/lib/auth/utils", () => ({
  getSession: () => getSessionMock(),
}));

vi.mock("@/lib/clients/utils/core-api-base-url", () => ({
  getCoreApiBaseUrl: () => "https://core.example.com/v1",
}));

import { POST } from "../route";

function createReadonlyHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);

  return new Proxy(headers, {
    get(target, prop, receiver) {
      if (prop === "append" || prop === "delete" || prop === "set") {
        return () => {
          throw new Error("Headers cannot be modified.");
        };
      }

      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Headers;
}

describe("chat route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("returns 401 when the request is unauthenticated", async () => {
    getSessionMock.mockResolvedValue(null);

    const response = await POST(
      new Request("https://app.sokosumi.com/api/chat", {
        method: "POST",
        body: JSON.stringify({ prompt: "Hello" }),
      }) as never,
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clones readonly request headers before forwarding the request", async () => {
    getSessionMock.mockResolvedValue({
      session: { activeOrganizationId: null },
      user: { id: "user-1" },
    });
    headersMock.mockResolvedValue(
      createReadonlyHeaders({
        cookie: "session=abc",
        "content-length": "999",
        "x-organization-slug": "my-org",
      }),
    );
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
        },
      }),
    );

    const body = { prompt: "Hello" };
    const response = await POST(
      new Request("https://app.sokosumi.com/api/chat", {
        method: "POST",
        body: JSON.stringify(body),
      }) as never,
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const forwardedHeaders = init.headers as Headers;

    expect(response.status).toBe(200);
    expect(url).toBe("https://core.example.com/v1/conversations/chat");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(body));
    expect(forwardedHeaders).toBeInstanceOf(Headers);
    expect(forwardedHeaders.get("cookie")).toBe("session=abc");
    expect(forwardedHeaders.get("x-organization-slug")).toBe("my-org");
    expect(forwardedHeaders.get("content-type")).toBe("application/json");
    expect(forwardedHeaders.has("content-length")).toBe(false);
  });
});
