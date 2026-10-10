"use client";

import type {
  ProjectSocialConnection,
  SocialPost,
  SocialPostMediaRef,
  SocialPostStatus,
} from "@sokosumi/core-client";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import {
  AlertTriangle,
  ExternalLink,
  Eye,
  FileText,
  Link2,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";
import type { SocialPostComposerMode } from "@/app/projects/components/social-posts/social-post-composer-dialog";
import { SocialPostComposerDialog } from "@/app/projects/components/social-posts/social-post-composer-dialog";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import { useSocialCompose } from "@/app/social/components/social-compose-context";
import { EmptyState } from "@/components/common/empty-state";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileChipMiniPreview } from "@/components/ui/file-chip-mini-preview";
import {
  SEGMENTED_TAB_TRIGGER_CLASS_NAME,
  SEGMENTED_TABS_LIST_CLASS_NAME,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  type ActionError,
  toActionRejectionError,
} from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import {
  cancelProjectSocialPost,
  publishProjectSocialPost,
} from "@/lib/actions/project/action";
import { cn } from "@/lib/utils";
import { loadMoreSocialPosts } from "./actions";
import {
  SECTION_ORDER,
  SECTION_STATUSES,
  type SectionKey,
  SOCIAL_TABS,
  type SocialTab,
} from "./constants";
import { socialPostAccountLabel } from "./social-post-account-label";
import { SocialPostMetrics } from "./social-post-metrics";
import { SocialPostPreviewDialog } from "./social-post-preview-dialog";
import { SocialPostStatistics } from "./social-post-statistics";

interface ProjectSocialPostsProps {
  /** Social's calendar, shown as the first tab when given. */
  calendar?: ReactNode;
  /** The project's Social accounts, shown as the last tab when given. */
  accounts?: ReactNode;
  /** Page actions (New post) that sit on the tab row. */
  actions?: ReactNode;
  /** Active connections only; drives the account picker. */
  connections: ProjectSocialConnection[];
  /**
   * Managed accounts on the Accounts tab (active, pending, reconnect).
   * Defaults to `connections.length` when the page only loaded actives.
   */
  accountCount?: number;
  posts: SocialPost[];
  nextCursors?: Partial<Record<SectionKey, string | null>>;
  projectId: string;
  /** Render only the post dialog and its actions for an unscoped calendar. */
  previewOnly?: boolean;
  returnFocus?: () => void;
  /**
   * The post a link names (`?postId=`), opened in a preview without changing tabs.
   */
  selectedPostId?: string;
}

/** Statuses whose previous attempt already ran, so the publish action reads as a retry. */
const RETRY_STATUSES: readonly SocialPostStatus[] = ["FAILED", "MISSED"];

function timeOf(value: Date | null): number {
  return value ? new Date(value).getTime() : 0;
}

function sectionOf(post: SocialPost): SectionKey | undefined {
  return SECTION_ORDER.find((section) =>
    SECTION_STATUSES[section].includes(post.status),
  );
}

function sortSection(posts: SocialPost[]): SocialPost[] {
  return [...posts].sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt));
}

function isRevisionConflict(error: ActionError): boolean {
  return error.kind === CORE_API_ERROR_KINDS.SOCIAL_POST_REVISION_CONFLICT;
}

function isBrowserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function isTimeoutRejection(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = "name" in error ? error.name : undefined;
  if (name === "AbortError" || name === "TimeoutError") return true;
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message.toLowerCase()
      : "";
  return message.includes("timed out") || message.includes("timeout");
}

function upsertPost(posts: SocialPost[], next: SocialPost): SocialPost[] {
  const index = posts.findIndex((post) => post.id === next.id);
  if (index === -1) return [next, ...posts];
  return posts.map((post) => (post.id === next.id ? next : post));
}

/**
 * Compact row thumbnail. Images and GIFs reuse the shared mini preview;
 * video shows its first frame in the same 48px frame.
 */
function SocialPostMediaThumb({ media }: { media: SocialPostMediaRef }) {
  if (media.kind !== "video") {
    return (
      <FileChipMiniPreview
        fileName={media.name}
        mediaType={media.mimeType}
        size={media.size}
        sizeClass="size-12"
        url={media.fileUrl}
      />
    );
  }

  return (
    <a
      aria-label={media.name}
      className="bg-card-background press hover:bg-card-background-hover focus-visible:ring-ring focus-visible:ring-2 relative block size-12 shrink-0 overflow-hidden rounded-xl border outline-none transition-[color,background-color,border-color,transform]"
      href={media.fileUrl}
      rel="noreferrer noopener"
      target="_blank"
    >
      <video
        className="size-full object-cover"
        muted
        playsInline
        preload="metadata"
        src={media.fileUrl}
      />
    </a>
  );
}

export function ProjectSocialPosts({
  accounts,
  accountCount,
  actions,
  calendar,
  connections,
  posts: initialPosts,
  nextCursors,
  projectId,
  selectedPostId,
  previewOnly = false,
  returnFocus,
}: ProjectSocialPostsProps) {
  const router = useRouter();
  const t = useTranslations("App.Projects.SocialPosts");
  const formatter = useFormatter();
  const [syncedPosts, setSyncedPosts] = useState(initialPosts);
  const [posts, setPosts] = useState(initialPosts);
  const [cursors, setCursors] = useState(nextCursors ?? {});
  const [loadingSection, setLoadingSection] = useState<SectionKey | null>(null);
  const [tabParam, setTabParam] = useQueryState(
    "tab",
    parseAsStringLiteral(SOCIAL_TABS),
  );
  const sourceRef = useRef(initialPosts);
  sourceRef.current = initialPosts;
  if (syncedPosts !== initialPosts) {
    setSyncedPosts(initialPosts);
    setPosts(initialPosts);
    setCursors(nextCursors ?? {});
  }
  const [composer, setComposer] = useState<SocialPostComposerMode | null>(null);
  // Social's top-level New post menu opens a fresh composer through context.
  const compose = useSocialCompose();
  const composerMode: SocialPostComposerMode | null =
    composer ?? (compose?.open ? { kind: "create" } : null);
  const [cancelTarget, setCancelTarget] = useState<SocialPost | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [publishTarget, setPublishTarget] = useState<SocialPost | null>(null);
  const [publishPending, setPublishPending] = useState(false);
  // The target outlives `previewOpen` so the dialog keeps its content while it
  // animates closed.
  const [previewTarget, setPreviewTarget] = useState<SocialPost | null>(
    initialPosts.find((post) => post.id === selectedPostId) ?? null,
  );
  const [previewOpen, setPreviewOpen] = useState(Boolean(selectedPostId));
  const [linkedPostId, setLinkedPostId] = useState(selectedPostId);
  if (linkedPostId !== selectedPostId) {
    setLinkedPostId(selectedPostId);
    const linkedPost =
      initialPosts.find((post) => post.id === selectedPostId) ?? null;
    setPreviewTarget(linkedPost);
    setPreviewOpen(Boolean(linkedPost));
  }

  function handleCloseAutoFocus(event: Event) {
    if (!returnFocus) return;
    event.preventDefault();
    if (!composerMode && !cancelTarget && !publishTarget) returnFocus();
  }

  function postsIn(section: SectionKey): SocialPost[] {
    return sortSection(
      posts.filter((post) => SECTION_STATUSES[section].includes(post.status)),
    );
  }

  // Needs attention is a tab only while something needs it. Once the last
  // post in it is dealt with, the page goes back to its first tab.
  const tabs: SocialTab[] = SOCIAL_TABS.filter((candidate) => {
    if (candidate === "calendar") return calendar !== undefined;
    if (candidate === "accounts") return accounts !== undefined;
    return (
      candidate !== "attention" ||
      postsIn(candidate).length > 0 ||
      Boolean(cursors[candidate])
    );
  });
  const tab: SocialTab =
    tabParam && tabs.includes(tabParam) ? tabParam : tabs[0];
  const listedAccountCount = accountCount ?? connections.length;
  const accountPrompt =
    accounts === undefined || tab === "accounts"
      ? null
      : listedAccountCount === 0
        ? "connect"
        : connections.length === 0
          ? "reconnect"
          : null;

  function showTab(next: SocialTab | null): void {
    void setTabParam(next);
  }

  function handleActionError(error: ActionError, cause?: unknown): void {
    if (error.code === CommonErrorCode.UNAUTHENTICATED) {
      toast.error(t("toasts.unauthenticated"), {
        action: {
          label: t("toasts.unauthenticatedAction"),
          onClick: () => router.push("/signin"),
        },
      });
      return;
    }
    if (isRevisionConflict(error)) {
      setPublishTarget(null);
      toast.error(t("toasts.conflict"));
      setComposer(null);
      compose?.setOpen(false);
      setCancelTarget(null);
      router.refresh();
      return;
    }
    if (isBrowserOffline()) {
      toast.error(t("toasts.offline"));
      return;
    }
    if (isTimeoutRejection(cause)) {
      toast.error(t("toasts.timeout"));
      return;
    }
    toast.error(error.message || t("toasts.failed"));
  }

  async function handleLoadMore(section: SectionKey): Promise<void> {
    const cursor = cursors[section];
    if (!cursor || loadingSection) return;
    const source = initialPosts;
    setLoadingSection(section);
    try {
      const page = await loadMoreSocialPosts({ projectId, section, cursor });
      if (sourceRef.current !== source) return;
      setPosts((current) => page.posts.reduce(upsertPost, current));
      setCursors((current) => ({ ...current, [section]: page.nextCursor }));
    } catch {
      toast.error(t("toasts.failed"));
    } finally {
      setLoadingSection(null);
    }
  }

  function handleSaved(post: SocialPost): void {
    setPosts((current) => upsertPost(current, post));
    // Follow the post to the tab that shows it now, so a new draft, a
    // scheduled draft or a failed publish stays in view.
    if (previewOnly) router.refresh();
    else
      showTab(sectionOf(post) ?? (calendar !== undefined ? "calendar" : null));
  }

  async function handleConfirmCancel(): Promise<void> {
    const target = cancelTarget;
    if (!target || cancelPending) return;
    setCancelPending(true);
    try {
      const result = await cancelProjectSocialPost({
        projectId,
        postId: target.id,
        revision: target.revision,
      });
      if (!result.ok) {
        handleActionError(result.error);
        return;
      }
      toast.success(t("toasts.canceled"));
      handleSaved(result.value);
    } catch (error) {
      handleActionError(toActionRejectionError(error), error);
    } finally {
      setCancelPending(false);
      setCancelTarget(null);
    }
  }

  async function handleConfirmPublish(): Promise<void> {
    const target = publishTarget;
    if (!target || publishPending) return;
    setPublishPending(true);
    try {
      const result = await publishProjectSocialPost({
        projectId,
        postId: target.id,
        revision: target.revision,
      });
      if (!result.ok) {
        handleActionError(result.error);
        return;
      }
      const post = result.value;
      handleSaved(post);
      if (post.status === "PUBLISHED") {
        toast.success(t("toasts.published"));
      } else if (post.lastError) {
        const error =
          post.lastAttempt?.outcome === "authorization_revoked"
            ? t("outcomes.authorizationRevoked")
            : post.lastError;
        toast.error(t("toasts.publishFailed", { error }));
      } else {
        toast.error(t("toasts.failed"));
      }
    } catch (error) {
      handleActionError(toActionRejectionError(error), error);
    } finally {
      setPublishPending(false);
      setPublishTarget(null);
    }
  }

  function renderPostActions(post: SocialPost, preview = false) {
    const isRetry = RETRY_STATUSES.includes(post.status);
    // A post that failed or missed its time has one thing left to do, so
    // Retry sits on the row, the way Reconnect does on a Social account.
    const canRetry = isRetry && post.canPublishNow;
    const canPublishNow = !isRetry && post.canPublishNow;
    const hasMenu =
      canPublishNow || post.canEdit || post.canSchedule || post.canCancel;
    return (
      <div
        className="ms-auto flex items-center gap-2"
        data-testid={preview ? `social-post-${post.id}` : undefined}
      >
        {!preview ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("preview.open")}
            data-testid={`social-post-preview-open-${post.id}`}
            onClick={() => {
              setPreviewTarget(post);
              setPreviewOpen(true);
            }}
          >
            <Eye className="size-4" aria-hidden />
          </Button>
        ) : null}
        {canRetry ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              if (preview) setPreviewOpen(false);
              setPublishTarget(post);
            }}
          >
            <RotateCcw className="size-4" aria-hidden />
            {t("actions.retry")}
          </Button>
        ) : null}
        {hasMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("moreActions")}
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canPublishNow ? (
                <DropdownMenuItem
                  onSelect={() => {
                    if (preview) setPreviewOpen(false);
                    setPublishTarget(post);
                  }}
                >
                  {t("actions.publishNow")}
                </DropdownMenuItem>
              ) : null}
              {post.canEdit ? (
                <DropdownMenuItem
                  onSelect={() => {
                    if (preview) setPreviewOpen(false);
                    setComposer({ kind: "edit", post });
                  }}
                >
                  {t("composer.edit")}
                </DropdownMenuItem>
              ) : null}
              {post.canSchedule ? (
                <DropdownMenuItem
                  onSelect={() => {
                    if (preview) setPreviewOpen(false);
                    setComposer({ kind: "schedule", post });
                  }}
                >
                  {post.status === "SCHEDULED" || isRetry
                    ? t("composer.reschedule")
                    : t("composer.schedule")}
                </DropdownMenuItem>
              ) : null}
              {post.canCancel ? (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => {
                    if (preview) setPreviewOpen(false);
                    setCancelTarget(post);
                  }}
                >
                  {t("composer.cancel")}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    );
  }

  const publishCopy =
    publishTarget && RETRY_STATUSES.includes(publishTarget.status)
      ? "retryDialog"
      : "publishDialog";

  function renderPost(post: SocialPost) {
    const accountLabel = socialPostAccountLabel(
      post.socialConnection,
      t("noAccount"),
    );
    const creatorLabel = post.creator.name
      ? `${t(`creator.${post.creator.kind}`)} · ${post.creator.name}`
      : t(`creator.${post.creator.kind}`);
    const failedAt = post.lastAttempt?.finishedAt ?? null;
    const failureReason =
      post.lastAttempt?.outcome === "authorization_revoked"
        ? t("outcomes.authorizationRevoked")
        : post.lastError;

    return (
      <li
        key={post.id}
        id={`social-post-${post.id}`}
        // The Task board's card: one border weight, the primary border on
        // hover, and the status badge leading like a task's.
        className="bg-background border-border flex flex-wrap items-start gap-3 rounded-lg border p-3 transition-[border-color,box-shadow] hover:border-primary hover:shadow-sm"
        data-testid={`social-post-${post.id}`}
      >
        <span
          aria-hidden
          className="bg-background flex size-9 shrink-0 items-center justify-center rounded-md border"
        >
          <SocialPostProviderIcon provider={post.provider} className="size-5" />
        </span>
        <div className="min-w-48 flex-1 space-y-1.5">
          <p className="text-muted-foreground flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            {post.scheduledAt ? (
              <time
                className="text-foreground font-medium whitespace-nowrap tabular-nums"
                dateTime={post.scheduledAt.toISOString()}
              >
                {/* Named, so a reader in another zone does not misread it. */}
                {formatter.dateTime(post.scheduledAt, "dateTime", {
                  timeZoneName: "short",
                })}
              </time>
            ) : null}
            <span className="min-w-0 truncate">{accountLabel}</span>
            <SocialPostStatusBadge
              className="order-first"
              label={t(`status.${post.status}`)}
              status={post.status}
            />
          </p>
          <p className="text-sm whitespace-pre-wrap break-words">{post.text}</p>
          {post.media.length > 0 ? (
            <div
              className="flex flex-wrap items-center gap-1.5 pt-0.5"
              data-testid={`social-post-media-${post.id}`}
            >
              {post.media.map((ref) => (
                <SocialPostMediaThumb key={ref.pathname} media={ref} />
              ))}
            </div>
          ) : null}
          <p className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
            <span>{creatorLabel}</span>
            {post.attemptCount > 0 ? (
              <span>{t("attempts", { count: post.attemptCount })}</span>
            ) : null}
          </p>
          {post.connectionNeedsReconnect ? (
            <p
              className="text-semantic-warning flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
              data-testid="social-post-needs-reconnect"
              role="status"
            >
              <span className="inline-flex items-center gap-1">
                <AlertTriangle className="size-3" aria-hidden />
                {t("needsReconnect")}
              </span>
              {accounts !== undefined ? (
                <button
                  className="font-medium underline-offset-4 hover:underline"
                  onClick={() => showTab("accounts")}
                  type="button"
                >
                  {t("needsReconnectLink")}
                </button>
              ) : (
                <Link
                  className="font-medium underline-offset-4 hover:underline"
                  href="#social-accounts"
                >
                  {t("needsReconnectLink")}
                </Link>
              )}
            </p>
          ) : null}
          {post.status === "PUBLISHED" ? (
            <SocialPostMetrics statistics={post.statistics} compact />
          ) : null}
          {post.status === "PUBLISHED" ? (
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {post.publishedAt ? (
                <time dateTime={post.publishedAt.toISOString()}>
                  {t("publishedAt", {
                    date: formatter.dateTime(post.publishedAt, "dateTime"),
                  })}
                </time>
              ) : null}
              {post.publishedUrl ? (
                <a
                  className="text-primary inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
                  href={post.publishedUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {t("viewPost")}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : null}
            </div>
          ) : null}
          {post.status === "FAILED" ? (
            <div className="space-y-0.5 text-xs">
              {failureReason ? (
                <p className="text-destructive">{failureReason}</p>
              ) : null}
              {failedAt ? (
                <time
                  className="text-muted-foreground"
                  dateTime={failedAt.toISOString()}
                >
                  {t("failedAt", {
                    date: formatter.dateTime(failedAt, "dateTime"),
                  })}
                </time>
              ) : null}
            </div>
          ) : null}
          {post.status === "MISSED" && post.lastError ? (
            <p className="text-muted-foreground text-xs">{post.lastError}</p>
          ) : null}
        </div>
        {renderPostActions(post)}
      </li>
    );
  }

  return (
    <section className="space-y-4" data-testid="project-social-posts">
      {!previewOnly ? (
        <Tabs
          className="gap-4"
          value={tab}
          onValueChange={(value) => {
            const next = tabs.find((candidate) => candidate === value);
            // The first tab is the default, so it keeps the URL clean.
            if (next) {
              showTab(next === tabs[0] ? null : next);
            }
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <TabsList
              aria-label={t("title")}
              className={cn(
                SEGMENTED_TABS_LIST_CLASS_NAME,
                "app-scrollbar w-full min-w-0 max-w-full overflow-x-auto md:w-fit",
              )}
            >
              {tabs.map((candidate) => {
                const count =
                  candidate === "drafts" || candidate === "attention"
                    ? postsIn(candidate).length
                    : candidate === "accounts"
                      ? listedAccountCount
                      : 0;
                return (
                  <TabsTrigger
                    key={candidate}
                    className={SEGMENTED_TAB_TRIGGER_CLASS_NAME}
                    data-testid={`social-posts-tab-${candidate}`}
                    value={candidate}
                  >
                    {candidate === "attention" ? (
                      <AlertTriangle
                        className="text-semantic-warning size-4"
                        aria-hidden
                      />
                    ) : null}
                    {t(`sections.${candidate}`)}{" "}
                    {count > 0 ? (
                      <span className="text-muted-foreground tabular-nums">
                        {candidate !== "calendar" &&
                        candidate !== "accounts" &&
                        candidate !== "statistics" &&
                        cursors[candidate]
                          ? `${count}+`
                          : count}
                      </span>
                    ) : null}
                  </TabsTrigger>
                );
              })}
            </TabsList>
            {actions}
          </div>

          {accountPrompt ? (
            <div
              className="bg-card-background flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
              data-testid={
                accountPrompt === "reconnect"
                  ? "social-reconnect-prompt"
                  : "social-connect-prompt"
              }
            >
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {accountPrompt === "reconnect"
                    ? t("reconnectPrompt.title")
                    : t("connectPrompt.title")}
                </p>
                <p className="text-muted-foreground text-sm text-pretty">
                  {accountPrompt === "reconnect"
                    ? t("reconnectPrompt.body")
                    : t("connectPrompt.body")}
                </p>
              </div>
              <Button
                className="shrink-0"
                onClick={() => showTab("accounts")}
                size="sm"
                type="button"
              >
                {accountPrompt === "reconnect" ? (
                  <RefreshCw className="size-4" aria-hidden />
                ) : (
                  <Link2 className="size-4" aria-hidden />
                )}
                {accountPrompt === "reconnect"
                  ? t("reconnectPrompt.action")
                  : t("connectPrompt.action")}
              </Button>
            </div>
          ) : null}

          {calendar !== undefined ? (
            <TabsContent
              data-testid="social-posts-section-calendar"
              value="calendar"
            >
              {calendar}
            </TabsContent>
          ) : null}

          {SECTION_ORDER.filter((section) => tabs.includes(section)).map(
            (section) => {
              const sectionPosts = postsIn(section);
              const cursor = cursors[section];
              return (
                <TabsContent
                  key={section}
                  className="space-y-3"
                  data-testid={`social-posts-section-${section}`}
                  value={section}
                >
                  {sectionPosts.length > 0 ? (
                    <ul className="grid gap-2">
                      {sectionPosts.map(renderPost)}
                    </ul>
                  ) : cursor ? null : (
                    <EmptyState
                      description={t(`emptyHint.${section}`)}
                      icon={FileText}
                      title={t(`empty.${section}`)}
                    />
                  )}
                  {cursor ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={loadingSection !== null}
                      onClick={() => {
                        void handleLoadMore(section);
                      }}
                    >
                      {loadingSection === section
                        ? t("loading")
                        : t("loadMore")}
                    </Button>
                  ) : null}
                </TabsContent>
              );
            },
          )}

          <TabsContent
            value="statistics"
            data-testid="social-posts-section-statistics"
          >
            {tab === "statistics" ? (
              <SocialPostStatistics key={projectId} projectId={projectId} />
            ) : null}
          </TabsContent>

          {accounts !== undefined ? (
            <TabsContent
              data-testid="social-posts-section-accounts"
              value="accounts"
            >
              {accounts}
            </TabsContent>
          ) : null}
        </Tabs>
      ) : null}

      {composerMode ? (
        <SocialPostComposerDialog
          connections={connections}
          mode={composerMode}
          onConnectAccount={
            accounts !== undefined
              ? () => {
                  setComposer(null);
                  compose?.setOpen(false);
                  showTab("accounts");
                }
              : undefined
          }
          onCloseAutoFocus={handleCloseAutoFocus}
          onError={handleActionError}
          onOpenChange={(open) => {
            if (open) return;
            setComposer(null);
            compose?.setOpen(false);
          }}
          onSaved={handleSaved}
          open
          projectId={projectId}
        />
      ) : null}

      <SocialPostPreviewDialog
        post={
          previewTarget
            ? {
                ...previewTarget,
                socialConnection: previewTarget.socialConnection
                  ? {
                      ...previewTarget.socialConnection,
                      avatarUrl:
                        connections.find(
                          (connection) =>
                            connection.id ===
                            previewTarget.socialConnection?.id,
                        )?.avatarUrl ??
                        previewTarget.socialConnection.avatarUrl,
                    }
                  : null,
              }
            : null
        }
        onCloseAutoFocus={handleCloseAutoFocus}
        open={previewOpen}
        onOpenChange={(open) => {
          setPreviewOpen(open);
        }}
        actions={
          previewTarget ? renderPostActions(previewTarget, true) : undefined
        }
        onCompose={setComposer}
      />

      <AlertDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open && !cancelPending) setCancelTarget(null);
        }}
      >
        <AlertDialogContent onCloseAutoFocus={handleCloseAutoFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cancelDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("cancelDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelPending}>
              {t("composer.close")}
            </AlertDialogCancel>
            <AlertDialogAction
              loading={cancelPending}
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmCancel();
              }}
            >
              {t("cancelDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={publishTarget !== null}
        onOpenChange={(open) => {
          if (!open && !publishPending) setPublishTarget(null);
        }}
      >
        <AlertDialogContent onCloseAutoFocus={handleCloseAutoFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${publishCopy}.title`)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(`${publishCopy}.description`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={publishPending}>
              {t("composer.close")}
            </AlertDialogCancel>
            <AlertDialogAction
              loading={publishPending}
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmPublish();
              }}
            >
              {t(`${publishCopy}.confirm`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
