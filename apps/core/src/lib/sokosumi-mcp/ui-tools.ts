import type { UiId } from "@sokosumi/mcp-ui";

/**
 * A "show" tool: an optional rendering of a data tool's result (ADR 0083).
 * It takes its data twin's input schema, annotations and toolset, runs the
 * twin, and returns the twin's exact result with the view linked. It needs
 * no manifest row and no CLI command (docs/agents/agent-surface.md).
 */
export interface McpUiTool {
  name: string;
  /** The data twin in `MCP_TOOLS`. */
  data: string;
  /** The view in `@sokosumi/mcp-ui`. */
  ui: UiId;
  description: string;
}

export const MCP_UI_TOOLS: readonly McpUiTool[] = [];

/** The MCP Apps MIME type of a view (SEP-1865). */
export const UI_MIME_TYPE = "text/html;profile=mcp-app";

/** The MCP Apps extension a server advertises in its capabilities. */
export const UI_EXTENSION = "io.modelcontextprotocol/ui";

const VIEW_URI = /^ui:\/\/sokosumi\/([a-z0-9-]+)\.[0-9a-f]{8}\.html$/;

/**
 * The view id in `ui://sokosumi/<id>.<hash8>.html`, whatever the hash: a
 * conversation from before a deploy still holds the old one.
 */
export function viewIdOf(uri: string): string | undefined {
  return VIEW_URI.exec(uri)?.[1];
}
