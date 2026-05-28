import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMcpApiKey } from "@/app/components/MCP/use-mcp-api-key";

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({
    NEXT_PUBLIC_MCP_URL: "https://mcp.example.com/",
    NEXT_PUBLIC_NETWORK: "Mainnet",
  }),
}));

describe("useMcpApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the hosted OAuth MCP endpoint when opened", async () => {
    const { result } = renderHook(() => useMcpApiKey(true, "org-1"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.mcpUrl).toBe("https://mcp.example.com/mcp");
    expect(result.current.isKeyExisting).toBe(true);
    expect(result.current.isKeyDisabled).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("keeps the URL hidden while closed", async () => {
    const { result } = renderHook(() => useMcpApiKey(false, "org-1"));

    expect(result.current.mcpUrl).toBeNull();
  });

  it("rebuilds the hosted endpoint on retry", async () => {
    const { result } = renderHook(() => useMcpApiKey(false, "org-1"));

    act(() => {
      result.current.retryLoad();
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.mcpUrl).toBe("https://mcp.example.com/mcp");
  });

  it("generate action returns the hosted endpoint without creating an API key", async () => {
    const { result } = renderHook(() => useMcpApiKey(true, "org-1"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.generateMcpUrl();
    });

    expect(result.current.mcpUrl).toBe("https://mcp.example.com/mcp");
    expect(result.current.isKeyExisting).toBe(true);
  });
});
