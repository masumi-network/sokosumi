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
    name: "agents_show_hire",
    data: "agents_input_schema",
    ui: "agents-hire",
    description:
      "Show the person a form to hire an agent: its input as fields, then the price and the workspace balance to confirm. The person's Hire click starts the paid Job from the view, capped at the price shown. Takes agents_input_schema's arguments (`id`, and `workspace` for an organization) and returns its result. Use it when the person wants to hire an agent and fill in its input themselves; use agents_input_schema and agents_hire when you fill the input.",
  },
  {
    name: "jobs_show",
    data: "jobs_get",
    ui: "job-status",
    description:
      "Show a Job to the person: its status in plain words, the agent, when it started and finished, and once done its result, files and links. The view checks for updates while it is open, until the Job finishes. Takes jobs_get's arguments and returns its result. Use it when the person wants to see or follow a Job; use jobs_get when you only need the data.",
  },
  {
    name: "tasks_show",
    data: "tasks_get",
    ui: "task-detail",
    description:
      "Show one Task to the person: its name, status, assignee, due date and description, with its comments and Jobs when the person opens the timeline. Takes tasks_get's arguments and returns its result. Use it when the person wants to see a Task; use tasks_get when you only need the data.",
  },
  {
    name: "workspaces_show_social_posts",
    data: "workspaces_social_posts",
    ui: "social-posts",
    description:
      "Show the person the workspace's Social posts that need approval: each post's text, account, Project and schedule, with Review in Sokosumi and a Cancel the person confirms in the view. Pass `status: \"NEEDS_APPROVAL\"` and `limit: 100`. A person approves and publishes in Sokosumi; the view only cancels, through projects_social_post_cancel, which needs the social toolset. Takes workspaces_social_posts's arguments and returns its result. Use it when the person wants to review the posts waiting for them; use workspaces_social_posts when you only need the data.",
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
