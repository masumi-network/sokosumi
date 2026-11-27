import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMcpUrl } from "@/app/components/MCP/mcp-url";

const env = vi.hoisted(() => ({
  NEXT_PUBLIC_MCP_URL: undefined as string | undefined,
  NEXT_PUBLIC_CORE_APP_BASE_URL: undefined as string | undefined,
  NEXT_PUBLIC_NETWORK: "Mainnet" as "Mainnet" | "Preprod",
}));

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => env,
}));

describe("getMcpUrl", () => {
  beforeEach(() => {
    env.NEXT_PUBLIC_MCP_URL = undefined;
    env.NEXT_PUBLIC_CORE_APP_BASE_URL = undefined;
    env.NEXT_PUBLIC_NETWORK = "Mainnet";
  });

  it("is Core's /mcp on mainnet when no MCP URL is set", () => {
    expect(getMcpUrl()).toBe("https://api.sokosumi.com/mcp");
  });

  it("is Core's /mcp on preprod when no MCP URL is set", () => {
    env.NEXT_PUBLIC_NETWORK = "Preprod";
    expect(getMcpUrl()).toBe("https://api.preprod.sokosumi.com/mcp");
  });

  it("follows a configured Core URL, without its /v1", () => {
    env.NEXT_PUBLIC_CORE_APP_BASE_URL = "https://core.example.com/v1/";
    expect(getMcpUrl()).toBe("https://core.example.com/mcp");
  });

  it("uses an explicit MCP URL when one is set", () => {
    env.NEXT_PUBLIC_MCP_URL = "https://mcp.example.com/";
    expect(getMcpUrl()).toBe("https://mcp.example.com/mcp");
  });
});
