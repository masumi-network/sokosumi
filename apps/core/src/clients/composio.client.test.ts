import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    COMPOSIO_API_KEY: "ak_test_composio_key",
    COMPOSIO_API_BASE_URL: "https://backend.composio.dev",
  }),
}));

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("composio.client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("continues MCP server pagination when a page is empty but next_cursor is set", async () => {
    const targetName = "hermes-gmail-read-v5";
    const targetId = "mcp-server-uuid-123";

    fetchMock.mockImplementation((url: string | URL) => {
      const urlStr = url.toString();
      if (!urlStr.includes("/api/v3/mcp/servers")) {
        throw new Error(`Unexpected fetch: ${urlStr}`);
      }

      const parsed = new URL(urlStr);
      const cursor = parsed.searchParams.get("cursor");
      if (!cursor) {
        return Promise.resolve(
          jsonResponse({ items: [], next_cursor: "cursor-page-2" }),
        );
      }
      if (cursor === "cursor-page-2") {
        return Promise.resolve(
          jsonResponse({
            items: [{ id: targetId, name: targetName }],
            next_cursor: null,
          }),
        );
      }
      throw new Error(`Unexpected cursor: ${cursor}`);
    });

    const { ensureMcpServer } = await import("./composio.client");
    const id = await ensureMcpServer("gmail", "read", "auth-config-id");

    expect(id).toBe(targetId);

    const mcpListCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/api/v3/mcp/servers"),
    );
    expect(mcpListCalls).toHaveLength(2);

    const createCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).includes("/api/v3/mcp/servers") &&
        (init as RequestInit | undefined)?.method === "POST",
    );
    expect(createCalls).toHaveLength(0);
  });
});
