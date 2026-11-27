import { getEnvPublicConfig } from "@/config/env.public";
import { getBrowserCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url.browser";
import {
  joinCoreApiPath,
  stripCoreApiVersionSuffix,
} from "@/lib/clients/utils/core-api-base-url.shared";

/** The hosted MCP server is Core's `/mcp`, unless NEXT_PUBLIC_MCP_URL names another host. */
export function getMcpUrl(): string {
  const base =
    getEnvPublicConfig().NEXT_PUBLIC_MCP_URL ??
    stripCoreApiVersionSuffix(getBrowserCoreApiBaseUrl());
  return joinCoreApiPath(base, "/mcp");
}
