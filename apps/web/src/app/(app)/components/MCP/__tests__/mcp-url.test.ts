import { describe, expect, it, vi } from "vitest";

import { getMcpUrl } from "@/app/components/MCP/mcp-url";

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({
    NEXT_PUBLIC_MCP_URL: "https://mcp.example.com/",
  }),
}));

describe("getMcpUrl", () => {
  it("returns the hosted MCP endpoint", () => {
    expect(getMcpUrl()).toBe("https://mcp.example.com/mcp");
  });
});
