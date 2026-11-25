import type { Transport } from "@modelcontextprotocol/client";
import type { App, McpUiDisplayMode } from "@modelcontextprotocol/ext-apps";
import type { ReactNode } from "react";
import type { z } from "zod";
import { type MessageKey, t } from "./text.ts";
import { Message, Skeleton } from "./ui.tsx";
import {
  type ConnectionState,
  useViewConnection,
} from "./use-view-connection.ts";

export interface ViewContext {
  app: App;
  /** BCP 47 locale and IANA time zone from the host, for `formatDateTime`. */
  locale?: string;
  timeZone?: string;
  /** Core's `_meta.sokosumi.webBaseUrl`: the only links a view may open. */
  webBaseUrl?: string;
  /** How the host shows the view now, and the modes it can switch to. */
  displayMode?: McpUiDisplayMode;
  availableDisplayModes?: McpUiDisplayMode[];
  /**
   * Re-runs `refreshTool` with the call's arguments and shows the new result;
   * false when it fails, keeping the last one. Absent when the host cannot
   * call server tools or has not sent the arguments.
   */
  refresh?: () => Promise<boolean>;
  /**
   * The refresh tool, once the server answered that it does not offer it:
   * its toolset is off. A view says which toolset to add.
   */
  missingTool?: string;
  /**
   * The HTTP status Core put on the last refresh's error result, such as 404,
   * until a refresh succeeds.
   */
  refreshStatus?: number;
}

export interface ShellProps<T> {
  app: App;
  transport?: Transport;
  /** Validates the tool result's `structuredContent`. */
  schema: z.ZodType<T>;
  isEmpty?: (data: T) => boolean;
  /** The empty state's text; the shell's generic text otherwise. */
  empty?: { title: MessageKey; body: MessageKey };
  /** The data twin `context.refresh` re-runs. */
  refreshTool?: string;
  children: (data: T, context: ViewContext) => ReactNode;
}

type ViewState<T> =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "empty" }
  | { kind: "ready"; data: T; webBaseUrl?: string };

function resolve<T>(
  connection: ConnectionState,
  schema: z.ZodType<T>,
  isEmpty?: (data: T) => boolean,
): ViewState<T> {
  if (connection.status === "loading") return { kind: "loading" };
  if (connection.status === "failed" || connection.result.isError) {
    return { kind: "error" };
  }
  const parsed = schema.safeParse(connection.result.structuredContent);
  if (!parsed.success) return { kind: "error" };
  if (isEmpty?.(parsed.data)) return { kind: "empty" };
  const meta = connection.result._meta?.sokosumi;
  const webBaseUrl =
    meta && typeof meta === "object" && "webBaseUrl" in meta
      ? meta.webBaseUrl
      : undefined;
  return {
    kind: "ready",
    data: parsed.data,
    webBaseUrl: typeof webBaseUrl === "string" ? webBaseUrl : undefined,
  };
}

/**
 * The frame every view shares: connects to the host, then shows a skeleton,
 * the error or empty state, or the view itself.
 */
export function Shell<T>({
  app,
  transport,
  schema,
  isEmpty,
  empty = { title: "shell.empty.title", body: "shell.empty.body" },
  refreshTool,
  children,
}: ShellProps<T>) {
  const [connection, rerun] = useViewConnection(app, transport);
  const view = resolve(connection, schema, isEmpty);
  const { input, host } = connection;
  const refresh =
    refreshTool && input && app.getHostCapabilities()?.serverTools
      ? () =>
          rerun(
            refreshTool,
            input,
            (result) => schema.safeParse(result.structuredContent).success,
          )
      : undefined;

  return (
    <main data-state={view.kind} className="p-4">
      {view.kind === "loading" && <Skeleton />}
      {view.kind === "error" && (
        <Message title={t("shell.error.title")} body={t("shell.error.body")} />
      )}
      {view.kind === "empty" && (
        <Message title={t(empty.title)} body={t(empty.body)} />
      )}
      {view.kind === "ready" &&
        children(view.data, {
          app,
          locale: host.locale,
          timeZone: host.timeZone,
          webBaseUrl: view.webBaseUrl,
          displayMode: host.displayMode,
          availableDisplayModes: host.availableDisplayModes,
          refresh,
          missingTool: connection.missingTool,
          refreshStatus: connection.refreshStatus,
        })}
    </main>
  );
}
