import type { Transport } from "@modelcontextprotocol/client";
import {
  type App,
  applyDocumentTheme,
  applyHostStyleVariables,
  type McpUiHostContext,
  type McpUiTheme,
  type McpUiToolResultNotification,
} from "@modelcontextprotocol/ext-apps";
import { useCallback, useEffect, useRef, useState } from "react";

export type ToolResult = McpUiToolResultNotification["params"];

export type ConnectionState = {
  host: McpUiHostContext;
  /** The tool call's arguments, once the host sends them. */
  input?: Record<string, unknown>;
  /** A tool the last rerun named that the server does not offer. */
  missingTool?: string;
  /** The HTTP status in the last rerun's error result, until one succeeds. */
  refreshStatus?: number;
} & (
  | { status: "loading" }
  | { status: "result"; result: ToolResult }
  | { status: "failed" }
);

/**
 * Calls a server tool through the host. A result `accept` takes replaces the
 * shown one, keeping its `_meta` (such as Core's `webBaseUrl`, which only the
 * show tool adds) under the new result's own. When the server does not offer
 * the tool (its toolset is off), the state names it in `missingTool`; an
 * error result's HTTP status (Core's `structuredContent.status`) is in
 * `refreshStatus`.
 */
export type Rerun = (
  name: string,
  args: Record<string, unknown>,
  accept: (result: ToolResult) => boolean,
) => Promise<boolean>;

/**
 * Whether a failed call is Core's answer to a tool outside the server's
 * toolsets: `Unknown tool: <name>` (`server.ts`), as a thrown protocol error
 * or, from some hosts, as an error result's whole text.
 */
function isUnknownTool(failure: unknown, name: string): boolean {
  const answer = `Unknown tool: ${name}`;
  if (failure instanceof Error) return failure.message.endsWith(answer);
  if (!failure || typeof failure !== "object") return false;
  const { content } = failure as Partial<ToolResult>;
  return (content ?? []).some(
    (block) => block.type === "text" && block.text.trim().endsWith(answer),
  );
}

export function systemTheme(): McpUiTheme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** The host's theme, else the system's, and any style variables it sends. */
export function applyHostTheme(host: McpUiHostContext): void {
  applyDocumentTheme(host.theme ?? systemTheme());
  if (host.styles?.variables) applyHostStyleVariables(host.styles.variables);
}

/**
 * Connects the view to its host (the `ui/initialize` handshake) and follows
 * the tool input, result, cancellation and host context changes. The handlers are
 * set before `connect`, so a result the host sends right after the handshake
 * is not missed. Omit `transport` to talk to `window.parent`.
 */
export function useViewConnection(
  app: App,
  transport?: Transport,
): [ConnectionState, Rerun] {
  const [state, setState] = useState<ConnectionState>({
    status: "loading",
    host: {},
  });
  const open = useRef(false);
  const update = useCallback(
    (next: (previous: ConnectionState) => ConnectionState) => {
      if (open.current) setState(next);
    },
    [],
  );

  useEffect(() => {
    open.current = true;
    const syncHost = () => {
      const host = app.getHostContext() ?? {};
      applyHostTheme(host);
      update((previous) => ({ ...previous, host }));
    };

    app.ontoolinput = ({ arguments: input }) =>
      update((previous) => ({ ...previous, input }));
    app.ontoolresult = (result) =>
      update(({ host, input }) => ({ status: "result", host, input, result }));
    app.ontoolcancelled = () =>
      update(({ host, input }) => ({ status: "failed", host, input }));
    app.onhostcontextchanged = syncHost;
    app
      .connect(transport)
      .then(syncHost, () =>
        update(({ host, input }) => ({ status: "failed", host, input })),
      );

    return () => {
      open.current = false;
      void app.close();
    };
  }, [app, transport, update]);

  const rerun = useCallback<Rerun>(
    async (name, args, accept) => {
      const missing = (failure: unknown) => {
        if (isUnknownTool(failure, name)) {
          update((previous) => ({ ...previous, missingTool: name }));
        }
        return false;
      };
      try {
        const result = await app.callServerTool({ name, arguments: args });
        if (result.isError) {
          const { status } = (result.structuredContent ?? {}) as {
            status?: unknown;
          };
          if (typeof status === "number") {
            update((previous) => ({ ...previous, refreshStatus: status }));
          }
          return missing(result);
        }
        if (!accept(result)) return false;
        update((previous) =>
          previous.status === "result"
            ? {
                ...previous,
                missingTool: undefined,
                refreshStatus: undefined,
                result: {
                  ...result,
                  _meta: { ...previous.result._meta, ...result._meta },
                },
              }
            : previous,
        );
        return true;
      } catch (error) {
        return missing(error);
      }
    },
    [app, update],
  );

  return [state, rerun];
}
