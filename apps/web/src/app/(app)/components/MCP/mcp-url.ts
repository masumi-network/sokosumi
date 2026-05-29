import { getEnvPublicConfig } from "@/config/env.public";

export function getMcpUrl(): string {
  const baseUrl = getEnvPublicConfig().NEXT_PUBLIC_MCP_URL.replace(/\/$/, "");
  return `${baseUrl}/mcp`;
}
