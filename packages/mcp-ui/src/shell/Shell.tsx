import type { Transport } from "@modelcontextprotocol/client";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { ReactNode } from "react";
import type { z } from "zod";
import { t } from "./text.ts";
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
}

export interface ShellProps<T> {
  app: App;
  transport?: Transport;
  /** Validates the tool result's `structuredContent`. */
  schema: z.ZodType<T>;
  isEmpty?: (data: T) => boolean;
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
  children,
}: ShellProps<T>) {
  const connection = useViewConnection(app, transport);
  const view = resolve(connection, schema, isEmpty);

  return (
    <main data-state={view.kind} className="p-4">
      {view.kind === "loading" && <Skeleton />}
      {view.kind === "error" && (
        <Message title={t("shell.error.title")} body={t("shell.error.body")} />
      )}
      {view.kind === "empty" && (
        <Message title={t("shell.empty.title")} body={t("shell.empty.body")} />
      )}
      {view.kind === "ready" &&
        children(view.data, {
          app,
          locale: connection.host.locale,
          timeZone: connection.host.timeZone,
          webBaseUrl: view.webBaseUrl,
        })}
    </main>
  );
}
