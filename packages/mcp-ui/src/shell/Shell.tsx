import type { Transport } from "@modelcontextprotocol/client";
import type { App, McpUiDisplayMode } from "@modelcontextprotocol/ext-apps";
import { Inbox, ShieldCheck, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { z } from "zod";
import { isUnderBase, type MessageKey, t } from "./text.ts";
import { PrimaryButton, Skeleton, StateMessage } from "./ui.tsx";
import {
  type ConnectionState,
  useViewConnection,
} from "./use-view-connection.ts";

export interface ViewContext {
  app: App;
  /** The tool call's arguments, once the host sends them. */
  input?: Record<string, unknown>;
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
  /**
   * Arguments the refresh sends over the call's: those the show tool always
   * sends its twin (`args` in Core's `ui-tools.ts`).
   */
  refreshArgs?: Readonly<Record<string, string>>;
  /** The loading skeleton's shape, like the view's layout. */
  skeleton?: "cards" | "detail" | "form";
  children: (data: T, context: ViewContext) => ReactNode;
}

type ViewState<T> =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "approval"; webUrl?: string }
  | { kind: "empty" }
  | { kind: "ready"; data: T; webBaseUrl?: string };

const PersonApproval = z.object({
  kind: z.literal("person_approval_required"),
  details: z.object({ webUrl: z.string() }).partial().nullish(),
});

const SokosumiMeta = z.object({
  sokosumi: z.object({ webBaseUrl: z.string() }),
});

function resolve<T>(
  connection: ConnectionState,
  schema: z.ZodType<T>,
  isEmpty?: (data: T) => boolean,
): ViewState<T> {
  if (connection.status === "loading") return { kind: "loading" };
  if (connection.status === "failed") return { kind: "error" };
  const { result } = connection;
  const webBaseUrl = SokosumiMeta.safeParse(result._meta).data?.sokosumi
    .webBaseUrl;
  if (result.isError) {
    // Only a person may take this step (ADR 0077): send them to Sokosumi.
    const approval = PersonApproval.safeParse(result.structuredContent).data;
    if (!approval) return { kind: "error" };
    const webUrl = approval.details?.webUrl;
    return {
      kind: "approval",
      webUrl: webUrl && isUnderBase(webUrl, webBaseUrl) ? webUrl : undefined,
    };
  }
  const parsed = schema.safeParse(result.structuredContent);
  if (!parsed.success) return { kind: "error" };
  if (isEmpty?.(parsed.data)) return { kind: "empty" };
  return { kind: "ready", data: parsed.data, webBaseUrl };
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
  refreshArgs,
  skeleton,
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
            { ...input, ...refreshArgs },
            (result) => schema.safeParse(result.structuredContent).success,
          )
      : undefined;

  return (
    <main data-state={view.kind} className="p-4">
      {view.kind === "loading" && <Skeleton shape={skeleton} />}
      {view.kind === "error" && (
        <StateMessage
          icon={TriangleAlert}
          title={t("shell.error.title")}
          body={t("shell.error.body")}
        />
      )}
      {view.kind === "approval" && (
        <PersonStep app={app} webUrl={view.webUrl} />
      )}
      {view.kind === "empty" && (
        <StateMessage
          icon={Inbox}
          title={t(empty.title)}
          body={t(empty.body)}
        />
      )}
      {view.kind === "ready" &&
        children(view.data, {
          app,
          input,
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

/** A step only a person takes (ADR 0077): no control here, a link to Sokosumi. */
function PersonStep({ app, webUrl }: { app: App; webUrl?: string }) {
  return (
    <StateMessage
      icon={ShieldCheck}
      title={t("shell.approval.title")}
      body={t("shell.approval.body")}
      action={
        webUrl && (
          <PrimaryButton
            onClick={() =>
              app.openLink({ url: webUrl }).catch((error: unknown) =>
                app.sendLog({
                  level: "warning",
                  data: `ui/open-link failed: ${String(error)}`,
                }),
              )
            }
          >
            {t("shell.approval.open")}
          </PrimaryButton>
        )
      }
    />
  );
}
