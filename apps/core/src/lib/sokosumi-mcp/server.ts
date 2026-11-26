import {
  ProtocolError,
  ProtocolErrorCode,
  ResourceNotFoundError,
  Server,
  type ToolAnnotations,
} from "@modelcontextprotocol/server";
import { MCP_UI, type McpUiView } from "@sokosumi/mcp-ui";

import { getWebAppBaseUrl } from "@/config/env";

import { callTool, type ToolCaller } from "./dispatch";
import { type DerivedTool, getTools } from "./tool-schema";
import { MCP_TOOLSETS, toolsetOf } from "./tools";
import {
  MCP_UI_TOOLS,
  type McpUiTool,
  UI_EXTENSION,
  UI_MIME_TYPE,
  viewIdOf,
} from "./ui-tools";

/** What the agent reads first: the workspace rule and the toolsets. */
export function instructions(toolsets: readonly string[]): string {
  const others = MCP_TOOLSETS.filter((name) => !toolsets.includes(name));
  return [
    "Sokosumi tools act on the signed-in person's Sokosumi account.",
    toolsets.includes("workspaces")
      ? "Call workspaces_list first: a tool acts in the personal workspace unless you pass an organization workspace's slug as `workspace`."
      : "A tool acts in the personal workspace unless you pass an organization workspace's slug as `workspace`; ask the person for it, or for the workspaces toolset.",
    `Toolsets on: ${toolsets.join(", ")}.`,
    // These toolsets take a Task's `id` (SOKD-410).
    ...(["tasks", "task-sharing", "task-files"].some((name) =>
      toolsets.includes(name),
    )
      ? [
          "tasks_get takes a Task's identifier, such as SOK-12. Other tasks tools take a Task's `id` from tasks_get or tasks_list.",
          ...(toolsets.includes("tasks")
            ? []
            : ["Add the tasks toolset for them."]),
        ]
      : []),
    ...(toolsets.includes("drive")
      ? [
          "Drive tools other than tables take `scope` instead of `workspace`: `me` for the personal Drive, or `org` with the workspace's `organizationId`.",
        ]
      : []),
    ...(others.length > 0
      ? [
          `Off: ${others.join(", ")}. The person turns toolsets on with ?toolsets= on the server URL, comma-separated.`,
        ]
      : []),
  ].join(" ");
}

/**
 * A fresh, stateless MCP server for one HTTP request, acting for `caller`,
 * with the tools in `toolsets` (`tools.ts`), the UI tools whose data twin is
 * among them (`ui-tools.ts`), and every UI tool's view as a `ui://` resource.
 * Every tool call runs as a `/v1` request (`dispatch.ts`).
 */
export function createSokosumiMcpServer(
  caller: ToolCaller,
  toolsets: readonly string[],
): Server {
  const server = new Server(
    { name: "sokosumi", version: "1.0.0" },
    {
      capabilities: {
        tools: {},
        resources: {},
        // MCP Apps 2026-01-26 defines extension settings (`mimeTypes`) only
        // for the client ("Client (Host) Capabilities"); "Server Behavior"
        // has the server read them and declare none. So: empty settings.
        extensions: { [UI_EXTENSION]: {} },
      },
      instructions: instructions(toolsets),
    },
  );
  const tools = new Map(
    [...getTools()].filter(([name]) => toolsets.includes(toolsetOf(name))),
  );
  // A UI tool is on when its twin is: it sits in the twin's toolset.
  const uiTools = new Map<string, UiTool>();
  for (const row of MCP_UI_TOOLS) {
    const twin = tools.get(row.data);
    if (twin) {
      uiTools.set(row.name, { ...row, twin, view: MCP_UI[row.ui] });
    }
  }
  // Every registered view, whatever the toolsets: the HTML is static and holds
  // no data, and an older conversation still renders after the toolsets
  // change (ADR 0083).
  const views = new Map<string, McpUiView>(
    MCP_UI_TOOLS.map(({ ui }) => [ui, MCP_UI[ui]]),
  );

  server.setRequestHandler("tools/list", () => ({
    tools: [
      ...[...tools.values()].map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.input.inputSchema,
        annotations: annotations(tool),
      })),
      ...[...uiTools.values()].map(({ name, description, twin, view }) => ({
        name,
        description,
        inputSchema: twin.input.inputSchema,
        annotations: annotations(twin),
        _meta: { ui: { resourceUri: view.uri } },
      })),
    ],
  }));

  server.setRequestHandler("tools/call", async ({ params }) => {
    const args = params.arguments ?? {};
    const tool = tools.get(params.name);
    if (tool) return callTool(tool.input, args, caller);

    const uiTool = uiTools.get(params.name);
    if (!uiTool) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        `Unknown tool: ${params.name}`,
      );
    }
    const result = await callTool(uiTool.twin.input, args, caller);
    return {
      ...result,
      _meta: {
        ...result._meta,
        ui: { resourceUri: uiTool.view.uri },
        // The view opens links only under this base (ADR 0083).
        sokosumi: { webBaseUrl: getWebAppBaseUrl() },
      },
    };
  });

  // Views, by id: an old hash reads the current HTML.
  server.setRequestHandler("resources/list", () => ({
    resources: [...views].map(([id, view]) => ({
      uri: view.uri,
      name: id,
      mimeType: UI_MIME_TYPE,
    })),
  }));

  server.setRequestHandler("resources/read", ({ params }) => {
    const view = views.get(viewIdOf(params.uri) ?? "");
    if (!view) {
      throw new ResourceNotFoundError(
        params.uri,
        `Unknown view: ${params.uri}`,
      );
    }
    return {
      contents: [{ uri: params.uri, mimeType: UI_MIME_TYPE, text: view.html }],
    };
  });

  return server;
}

interface UiTool extends McpUiTool {
  twin: DerivedTool;
  view: McpUiView;
}

function annotations({
  input,
  destructive,
  spendsCredits = false,
  openWorld = false,
}: DerivedTool): ToolAnnotations {
  if (input.method === "GET") {
    return { readOnlyHint: true, openWorldHint: false };
  }
  return {
    readOnlyHint: false,
    destructiveHint:
      spendsCredits || (destructive ?? input.method === "DELETE"),
    idempotentHint: input.method === "PUT" || input.method === "DELETE",
    // Credits pay an outside agent; ad tools act on Google or Meta; some
    // Image Studio tools fetch a public website.
    openWorldHint: spendsCredits || openWorld,
  };
}
