import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the image proxy tells the browser when Core will not hand over bytes.
 *
 * The proxy used to collapse every upstream status except 401 into 404. Once
 * Core grew a 503 for "the studio's private store is not configured", that
 * flattening reported a version that still exists as deleted, and gave a
 * caller no reason to come back.
 */

const { readRouteSessionMock, fetchMock } = vi.hoisted(() => ({
  readRouteSessionMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/auth/route-session", () => ({
  readRouteSession: readRouteSessionMock,
}));
vi.mock("@/lib/clients/utils/build-core-chat-proxy-headers", () => ({
  buildCoreChatProxyHeaders: () => new Headers(),
}));
vi.mock("@/lib/clients/utils/core-api-base-url", () => ({
  getServerCoreApiBaseUrl: () => "https://core.test/v1",
}));

import { GET } from "./route";

const params = Promise.resolve({
  projectId: "project-1",
  assetId: "asset-1",
});

function request() {
  return new NextRequest(
    "https://app.test/api/projects/project-1/image-studio/assets/asset-1/content",
  );
}

describe("GET image studio asset content", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    readRouteSessionMock.mockResolvedValue({
      status: "signedIn",
      session: { user: { id: "user-1" } },
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("passes a storage outage through as 503 rather than calling it missing", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Service Unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await GET(request(), { params });

    expect(response.status).toBe(503);
    // A caller that sees 404 stops; one that sees 503 with a hint comes back.
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("still reports a genuinely missing version as 404", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Not Found" }), { status: 404 }),
    );

    const response = await GET(request(), { params });

    expect(response.status).toBe(404);
  });

  it("keeps an upstream 401 as 401", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    );

    const response = await GET(request(), { params });

    expect(response.status).toBe(401);
  });

  it("streams the bytes when Core serves them", async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );

    const response = await GET(request(), { params });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    // Permission to read is not cacheable even though the bytes are stable.
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
  });
});
