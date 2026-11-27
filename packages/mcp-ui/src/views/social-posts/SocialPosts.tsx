import { BadgeCheck, Eye, Image, MessagesSquare } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";
import type { ViewContext } from "../../shell/Shell.tsx";
import { type MarkerSpec, StatusMarker } from "../../shell/status.tsx";
import {
  formatDateTime,
  isMessageKey,
  isPlainReference,
  isUnderBase,
  type MessageKey,
  t,
} from "../../shell/text.ts";
import { Badge, Button } from "../../shell/ui.tsx";
import { ProviderIcon } from "./provider-icons.tsx";

/** Web's social-post-status-badge.tsx mark for a post waiting on approval. */
const NEEDS_APPROVAL_MARKER: MarkerSpec = {
  icon: BadgeCheck,
  hue: "warning",
  weight: "outline",
};

import { isUnknownTool } from "../../shell/use-view-connection.ts";

const CANCEL_TOOL = "projects_social_post_cancel";
const NEEDS_APPROVAL = "NEEDS_APPROVAL";

/** The fields of a `workspaces_social_posts` item the view reads. */
const WorkspacePost = z.object({
  post: z.object({
    id: z.string(),
    projectId: z.string(),
    provider: z.string(),
    text: z.string(),
    status: z.string(),
    scheduledAt: z.string().nullish(),
    socialConnection: z
      .object({
        displayName: z.string().nullish(),
        externalHandle: z.string().nullish(),
      })
      .nullish(),
    media: z.array(z.unknown()).nullish(),
    threadParts: z.array(z.unknown()).nullish(),
    revision: z.number(),
  }),
  projectName: z.string().nullish(),
  projectCmo: z.boolean().nullish(),
});
type WorkspacePost = z.infer<typeof WorkspacePost>;
type Post = WorkspacePost["post"];

/** `workspaces_social_posts`'s result, which the show tool returns unchanged. */
export const SocialPostsList = z.object({
  data: z.array(WorkspacePost),
  pagination: z
    .object({ total: z.number().nullish(), nextCursor: z.string().nullish() })
    .partial()
    .nullish(),
});
export type SocialPostsList = z.infer<typeof SocialPostsList>;

export const SOCIAL_EMPTY = {
  title: "socialPosts.empty.title",
  body: "socialPosts.empty.body",
} satisfies { title: MessageKey; body: MessageKey };

/** The view lists only what waits on the person, whatever the call asked for. */
function waiting(data: SocialPostsList): WorkspacePost[] {
  return data.data.filter(({ post }) => post.status === NEEDS_APPROVAL);
}

/** Core holds more posts than this page: the page alone can't say what waits. */
function hasMore({ data, pagination }: SocialPostsList): boolean {
  return !!pagination?.nextCursor || (pagination?.total ?? 0) > data.length;
}

export const isEmpty = (data: SocialPostsList) =>
  waiting(data).length === 0 && !hasMore(data);

/** A cancel's outcome, kept for the post revision it acted on. */
type Outcome =
  | "canceling"
  | "canceled"
  | "failed"
  | "conflict"
  | "missing-tool"
  | "unknown";

const keyOf = (post: Post) => `${post.id}:${post.revision}`;

export function SocialPosts({
  data,
  context,
}: {
  data: SocialPostsList;
  context: ViewContext;
}) {
  const { app, refresh, input = {} } = context;
  const workspace =
    typeof input.workspace === "string" && input.workspace
      ? input.workspace
      : undefined;
  const canCall = !!app.getHostCapabilities()?.serverTools;
  const posts = waiting(data);
  // Core filtered to Needs approval, so its total counts what waits.
  const filtered = input.status === NEEDS_APPROVAL;

  const [confirming, setConfirming] = useState<string>();
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  // Set before a call leaves, so a second click in the same frame is a no-op.
  const sending = useRef(new Set<string>());
  const canceledIds = useRef<string[]>([]);
  const [refreshing, setRefreshing] = useState<"idle" | "busy" | "failed">(
    "idle",
  );

  // Posts canceled here still read Needs approval until a refresh.
  const open = posts.filter(
    ({ post }) => outcomes[keyOf(post)] !== "canceled",
  ).length;

  const warn = (what: string) => (error: unknown) =>
    app
      .sendLog({ level: "warning", data: `${what} failed: ${String(error)}` })
      .catch(() => {});
  const settle = (key: string, outcome: Outcome) =>
    setOutcomes((previous) => ({ ...previous, [key]: outcome }));

  const cancel = async (post: Post) => {
    const key = keyOf(post);
    if (sending.current.has(key)) return;
    sending.current.add(key);
    setConfirming(undefined);
    settle(key, "canceling");
    try {
      const result = await app.callServerTool({
        name: CANCEL_TOOL,
        arguments: {
          id: post.projectId,
          postId: post.id,
          ...(workspace && { workspace }),
          body: { revision: post.revision },
        },
      });
      if (!result.isError) {
        settle(key, "canceled");
        // Model context replaces the last one, so it names every cancel.
        if (isPlainReference(post.id)) canceledIds.current.push(post.id);
        if (canceledIds.current.length > 0) {
          app
            .updateModelContext({
              content: [
                {
                  type: "text",
                  text: t("socialPosts.context", {
                    ids: canceledIds.current.join(", "),
                  }),
                },
              ],
            })
            .catch(warn("ui/update-model-context"));
        }
        return;
      }
      const { status } = (result.structuredContent ?? {}) as {
        status?: unknown;
      };
      settle(
        key,
        isUnknownTool(result, CANCEL_TOOL)
          ? "missing-tool"
          : status === 409
            ? "conflict"
            : "failed",
      );
    } catch (error) {
      if (isUnknownTool(error, CANCEL_TOOL)) {
        settle(key, "missing-tool");
        return;
      }
      // The call may have reached Core: never offer a second cancel.
      warn(CANCEL_TOOL)(error);
      settle(key, "unknown");
      return;
    }
    sending.current.delete(key);
  };

  const runRefresh = async () => {
    if (!refresh) return;
    setRefreshing("busy");
    setRefreshing((await refresh()) ? "idle" : "failed");
  };

  return (
    <article className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-base font-semibold tracking-tight">
            {t("socialPosts.title")}
          </h1>
          <p className="text-muted-foreground text-xs">
            {t(open === 1 ? "socialPosts.countOne" : "socialPosts.count", {
              count: open,
            })}
          </p>
          {hasMore(data) && (
            <p className="text-muted-foreground text-xs">
              {filtered && data.pagination?.total != null
                ? t("socialPosts.showing", {
                    shown: posts.length,
                    total: data.pagination.total,
                  })
                : t("socialPosts.partial")}
            </p>
          )}
        </div>
        {refresh && (
          <Button
            variant="ghost"
            className="-mx-3"
            onClick={runRefresh}
            disabled={refreshing === "busy"}
            aria-busy={refreshing === "busy"}
          >
            {refreshing === "busy" ? t("view.refreshing") : t("view.refresh")}
          </Button>
        )}
      </header>
      <p role="status" className="text-muted-foreground text-xs empty:hidden">
        {refreshing === "failed" ? t("view.refreshFailed") : ""}
      </p>

      <ul aria-label={t("socialPosts.title")} className="flex flex-col gap-2">
        {posts.map((item) => (
          <PostItem
            key={item.post.id}
            item={item}
            context={context}
            outcome={outcomes[keyOf(item.post)]}
            canCancel={canCall && !item.projectCmo}
            confirming={confirming === keyOf(item.post)}
            onAsk={() => setConfirming(keyOf(item.post))}
            onKeep={() => setConfirming(undefined)}
            onCancel={() => cancel(item.post)}
            onOpen={(url) => app.openLink({ url }).catch(warn("ui/open-link"))}
          />
        ))}
      </ul>
    </article>
  );
}

/** The post in Web's Social page, which opens it for review; only under `webBaseUrl`. */
function reviewUrl(post: Post, base: string | undefined): string | undefined {
  if (!base) return undefined;
  const query = new URLSearchParams({
    projectId: post.projectId,
    postId: post.id,
  });
  const url = `${base.replace(/\/$/, "")}/social?${query}`;
  return isUnderBase(url, base) ? url : undefined;
}

function providerName(provider: string): string {
  const key = `socialPosts.provider.${provider}`;
  return isMessageKey(key) ? t(key) : provider;
}

function accountName(post: Post): string | undefined {
  const account = post.socialConnection;
  if (account?.displayName) return account.displayName;
  if (account?.externalHandle) return `@${account.externalHandle}`;
  return undefined;
}

const OUTCOME_TEXT = {
  canceling: undefined,
  canceled: "socialPosts.canceled",
  failed: "socialPosts.failed",
  conflict: "socialPosts.conflict",
  "missing-tool": undefined,
  unknown: "socialPosts.unknown",
} as const satisfies Record<Outcome, MessageKey | undefined>;

function PostItem({
  item,
  context,
  outcome,
  canCancel,
  confirming,
  onAsk,
  onKeep,
  onCancel,
  onOpen,
}: {
  item: WorkspacePost;
  context: ViewContext;
  outcome?: Outcome;
  canCancel: boolean;
  confirming: boolean;
  onAsk: () => void;
  onKeep: () => void;
  onCancel: () => void;
  onOpen: (url: string) => void;
}) {
  const { post } = item;
  const url = reviewUrl(post, context.webBaseUrl);
  const source = [
    accountName(post),
    providerName(post.provider),
    item.projectName,
  ]
    .filter(Boolean)
    .join(" · ");
  const hasMedia = !!post.media?.length;
  const threadCount = post.threadParts?.length
    ? post.threadParts.length + 1
    : 0;
  // A failed cancel may be tried again. A conflict needs a refresh first: its
  // new revision gives the post a new key, and Cancel comes back.
  const offerCancel = canCancel && (!outcome || outcome === "failed");
  const note = outcome && OUTCOME_TEXT[outcome];

  return (
    <li className="bg-background border-border flex gap-3 rounded-lg border p-3">
      <ProviderIcon provider={post.provider} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="text-foreground inline-flex items-center gap-1.5 text-xs font-medium">
            <StatusMarker spec={NEEDS_APPROVAL_MARKER} />
            {t("socialPosts.needsApproval")}
          </span>
          {post.scheduledAt ? (
            <span className="text-foreground font-medium tabular-nums">
              {t("socialPosts.scheduled", {
                date: formatDateTime(post.scheduledAt, context),
              })}
            </span>
          ) : (
            <span>{t("socialPosts.unscheduled")}</span>
          )}
        </p>
        <p className="text-muted-foreground min-w-0 truncate text-xs">
          {source}
        </p>
        <p
          className={`line-clamp-4 text-sm break-words whitespace-pre-line ${outcome === "canceled" ? "text-muted-foreground" : ""}`}
        >
          {post.text || t("socialPosts.noText")}
        </p>
        {(threadCount > 0 || hasMedia) && (
          <div className="flex flex-wrap items-center gap-2">
            {threadCount > 0 && (
              <Badge variant="outline">
                <MessagesSquare aria-hidden="true" />
                {t("socialPosts.thread", { count: threadCount })}
              </Badge>
            )}
            {hasMedia && (
              <Badge variant="outline">
                <Image aria-hidden="true" />
                {t("socialPosts.media")}
              </Badge>
            )}
          </div>
        )}
        {item.projectCmo && (
          <p className="text-muted-foreground text-xs">
            {t("socialPosts.cmo")}
          </p>
        )}

        {note && (
          <p role="status" data-step={outcome} className="text-sm">
            {t(note)}
          </p>
        )}
        {outcome === "missing-tool" && (
          <div data-step="missing-tool" className="flex flex-col gap-1">
            <p className="text-sm font-semibold">
              {t("socialPosts.missingToolset.title")}
            </p>
            <p className="text-muted-foreground text-sm">
              {t("socialPosts.missingToolset.body")}
            </p>
            <code className="text-sm break-words">
              {t("socialPosts.missingToolset.example")}
            </code>
          </div>
        )}

        {confirming ? (
          <div data-step="confirm" className="flex flex-col gap-2">
            <p className="text-sm font-medium">{t("socialPosts.confirm")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="destructive" onClick={onCancel}>
                {t("socialPosts.cancelPost")}
              </Button>
              <Button onClick={onKeep}>{t("socialPosts.keep")}</Button>
            </div>
          </div>
        ) : (
          <div
            data-step={outcome === "canceling" ? "canceling" : undefined}
            className="flex flex-wrap items-center gap-2"
          >
            {url && (
              <Button onClick={() => onOpen(url)}>
                <Eye aria-hidden="true" />
                {t("socialPosts.review")}
              </Button>
            )}
            {outcome === "canceling" && (
              <Button variant="ghost" disabled aria-busy>
                {t("socialPosts.canceling")}
              </Button>
            )}
            {offerCancel && (
              <Button variant="ghost" onClick={onAsk}>
                {t("socialPosts.cancel")}
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
