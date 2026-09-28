import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the file proxy forwards, and what it refuses to.
 *
 * Two things matter here beyond "it streams". The query it sends upstream is
 * rebuilt from named parameters rather than passed through, so a caller
 * cannot append anything it likes to Core's URL. And the headers that stop
 * user-supplied bytes executing as a same-origin document are carried, not
 * dropped — this origin is the one holding the session cookie.
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

const params = Promise.resolve({ resourceId: "resource-1" });

function request(query = "?scope=me") {
  return new NextRequest(
    `https://app.test/api/drive/files/resource-1/content${query}`,
  );
}

function bytes(headers: Record<string, string> = {}) {
  return new Response("# Notes", {
    status: 200,
    headers: { "content-type": "text/markdown", ...headers },
  });
}

function upstreamUrl(): string {
  return fetchMock.mock.calls[0][0] as string;
}

describe("GET drive file content", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    readRouteSessionMock.mockResolvedValue({
      status: "signedIn",
      session: { user: { id: "user-1" } },
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("refuses a signed-out caller before reaching Core", async () => {
    readRouteSessionMock.mockResolvedValue({ status: "signedOut" });

    const response = await GET(request(), { params });

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("streams the bytes and keeps the type", async () => {
    fetchMock.mockResolvedValue(bytes({ etag: '"abc"' }));

    const response = await GET(request(), { params });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown");
    expect(response.headers.get("etag")).toBe('"abc"');
    expect(await response.text()).toBe("# Notes");
  });

  it("carries the headers that stop the bytes executing on this origin", async () => {
    fetchMock.mockResolvedValue(bytes());

    const response = await GET(request(), { params });

    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain(
      "sandbox",
    );
    // Permission can be revoked between reads, so a cached copy must come
    // back through the route that checks it.
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
  });

  it("forwards the scope and organization it was given", async () => {
    fetchMock.mockResolvedValue(bytes());

    await GET(request("?scope=org&organizationId=org-7"), { params });

    const url = new URL(upstreamUrl());
    expect(url.pathname).toBe("/v1/drive/resources/resource-1/content");
    expect(url.searchParams.get("scope")).toBe("org");
    expect(url.searchParams.get("organizationId")).toBe("org-7");
  });

  it("does not pass through parameters Core did not ask for", async () => {
    fetchMock.mockResolvedValue(bytes());

    await GET(request("?scope=me&evil=1&organizationId="), { params });

    const url = new URL(upstreamUrl());
    expect(url.searchParams.get("evil")).toBeNull();
    // An empty organizationId is omitted rather than sent as "".
    expect(url.searchParams.has("organizationId")).toBe(false);
    expect([...url.searchParams.keys()]).toEqual(["scope"]);
  });

  it("asks for a download only when the caller did", async () => {
    fetchMock.mockResolvedValue(bytes());
    await GET(request("?scope=me"), { params });
    expect(new URL(upstreamUrl()).searchParams.has("download")).toBe(false);

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(bytes());
    await GET(request("?scope=me&download=true"), { params });
    expect(new URL(upstreamUrl()).searchParams.get("download")).toBe("true");
  });

  it("carries the disposition so a download keeps its name", async () => {
    fetchMock.mockResolvedValue(
      bytes({ "content-disposition": 'attachment; filename="notes.md"' }),
    );

    const response = await GET(request("?scope=me&download=true"), { params });

    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="notes.md"',
    );
  });

  it("passes a storage outage through as 503 rather than calling it missing", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 503 }));

    const response = await GET(request(), { params });

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("answers a denied file the same way as a missing one", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 403 }));

    const response = await GET(request(), { params });

    expect(response.status).toBe(404);
  });

  it("does not turn an unauthenticated upstream into a 404", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));

    const response = await GET(request(), { params });

    expect(response.status).toBe(401);
  });
});
