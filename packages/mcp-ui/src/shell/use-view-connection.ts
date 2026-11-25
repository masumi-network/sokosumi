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
} & (
  | { status: "loading" }
  | { status: "result"; result: ToolResult }
  | { status: "failed" }
);

/** Calls a server tool through the host; a success replaces the result. */
export type Rerun = (
  name: string,
  args: Record<string, unknown>,
) => Promise<boolean>;

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
    async (name, args) => {
      try {
        const result = await app.callServerTool({ name, arguments: args });
        if (result.isError) return false;
        update((previous) =>
          previous.status === "result" ? { ...previous, result } : previous,
        );
        return true;
      } catch {
        return false;
      }
    },
    [app, update],
  );

  return [state, rerun];
}
