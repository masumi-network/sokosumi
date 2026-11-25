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

export const MCP_UI_TOOLS: readonly McpUiTool[] = [
  {
    name: "tasks_show_board",
    data: "tasks_list",
    ui: "tasks-board",
    description:
      "Show Tasks in a workspace to the person as a board: counts and the first Tasks per status, and every Task by status in full screen. Takes tasks_list's arguments and returns its result. Pass `limit: 100` so the board holds more than one page. Pass `scope: \"workspace\"` when the person asks for the team's or the workspace's board; otherwise leave the default. Use it when the person wants to see their Tasks; use tasks_list when you only need the data.",
  },
  {
    name: "jobs_show",
    data: "jobs_get",
    ui: "job-status",
    description:
      "Show a Job to the person: its status in plain words, the agent, when it started and finished, and once done its result, files and links. The view checks for updates while it is open, until the Job finishes. Takes jobs_get's arguments and returns its result. Use it when the person wants to see or follow a Job; use jobs_get when you only need the data.",
  },
];

/** The MCP Apps MIME type of a view (SEP-1865). */
export const UI_MIME_TYPE = "text/html;profile=mcp-app";

/** The MCP Apps extension a server advertises in its capabilities. */
export const UI_EXTENSION = "io.modelcontextprotocol/ui";

const VIEW_URI = /^ui:\/\/sokosumi\/([^/.]+)\.[0-9a-f]{8}\.html$/;

/**
 * The view id in `ui://sokosumi/<id>.<hash8>.html`, whatever the hash: a
 * conversation from before a deploy still holds the old one.
 */
export function viewIdOf(uri: string): string | undefined {
  return VIEW_URI.exec(uri)?.[1];
}
