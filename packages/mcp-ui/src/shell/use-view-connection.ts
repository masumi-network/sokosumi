import type { Transport } from "@modelcontextprotocol/client";
import {
  type App,
  applyDocumentTheme,
  applyHostStyleVariables,
  type McpUiHostContext,
  type McpUiTheme,
  type McpUiToolResultNotification,
} from "@modelcontextprotocol/ext-apps";
import { useEffect, useState } from "react";

export type ToolResult = McpUiToolResultNotification["params"];

export type ConnectionState =
  | { status: "loading"; host: McpUiHostContext }
  | { status: "result"; host: McpUiHostContext; result: ToolResult }
  | { status: "failed"; host: McpUiHostContext };

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
 * the tool result, cancellation and host context changes. The handlers are
 * set before `connect`, so a result the host sends right after the handshake
 * is not missed. Omit `transport` to talk to `window.parent`.
 */
export function useViewConnection(
  app: App,
  transport?: Transport,
): ConnectionState {
  const [state, setState] = useState<ConnectionState>({
    status: "loading",
    host: {},
  });

  useEffect(() => {
    let open = true;
    const update = (next: (previous: ConnectionState) => ConnectionState) => {
      if (open) setState(next);
    };
    const syncHost = () => {
      const host = app.getHostContext() ?? {};
      applyHostTheme(host);
      update((previous) => ({ ...previous, host }));
    };

    app.ontoolresult = (result) =>
      update(({ host }) => ({ status: "result", host, result }));
    app.ontoolcancelled = () =>
      update(({ host }) => ({ status: "failed", host }));
    app.onhostcontextchanged = syncHost;
    app
      .connect(transport)
      .then(syncHost, () => update(({ host }) => ({ status: "failed", host })));

    return () => {
      open = false;
      void app.close();
    };
  }, [app, transport]);

  return state;
}
