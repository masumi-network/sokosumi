"use client";

import { useMcpApiKey } from "@/app/components/MCP/use-mcp-api-key";

import { McpActiveKeyView } from "./mcp-active-key-view";
import { McpDisabledKeyState } from "./mcp-disabled-key-state";
import { McpEmptyState } from "./mcp-empty-state";
import { McpErrorState } from "./mcp-error-state";
import { McpLoadingState } from "./mcp-loading-state";

export function McpPageContent({
  activeOrganizationId,
}: {
  activeOrganizationId: string | null;
}) {
  const {
    mcpUrl,
    isLoading,
    error,
    generateMcpUrl,
    retryLoad,
    enableKey,
    isKeyExisting,
    isKeyDisabled,
  } = useMcpApiKey(true, activeOrganizationId);

  return (
    <div className="space-y-6">
      {isLoading && <McpLoadingState />}

      {error && <McpErrorState error={error} onRetry={retryLoad} />}

      {isKeyDisabled && (
        <McpDisabledKeyState
          onEnableKey={enableKey}
          onGenerateNew={generateMcpUrl}
          isLoading={isLoading}
        />
      )}

      {mcpUrl && (
        <McpActiveKeyView
          mcpUrl={mcpUrl}
          isKeyExisting={isKeyExisting}
          onRegenerate={generateMcpUrl}
          isLoading={isLoading}
        />
      )}

      {!isLoading && !error && !isKeyDisabled && !mcpUrl && (
        <McpEmptyState onGenerate={generateMcpUrl} isLoading={isLoading} />
      )}
    </div>
  );
}
