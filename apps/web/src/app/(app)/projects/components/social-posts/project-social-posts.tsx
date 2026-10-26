"use client";

import {
  type ProjectSocialConnection,
  type ProjectSocialProvider as ProjectSocialProviderValue,
  type SocialPost,
  type SocialPostStatus,
} from "@sokosumi/core-client";
import { CORE_API_ERROR_KINDS, isValidTimezone } from "@sokosumi/utils";
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
import { useFormatter, useTimeZone, useTranslations } from "next-intl";
import {
  parseAsString,
  parseAsStringEnum,
  parseAsStringLiteral,
  useQueryState,
} from "nuqs";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ProjectSocialAccounts } from "@/app/projects/components/project-social-accounts";
import { SocialLoadError } from "@/app/projects/components/social-posts/social-load-error";
import type { SocialPostComposerMode } from "@/app/projects/components/social-posts/social-post-composer-dialog";
import { SocialPostComposerDialog } from "@/app/projects/components/social-posts/social-post-composer-dialog";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import { useSocialCompose } from "@/app/social/components/social-compose-context";
import { EmptyState } from "@/components/common/empty-state";
import {
  SOCIAL_POST_PROVIDERS,
  SocialPlatformFilter,
} from "@/components/social-platform-filter";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import { TimezoneLabel } from "@/components/timezone-label";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SEGMENTED_TAB_TRIGGER_CLASS_NAME,
  SEGMENTED_TABS_LIST_CLASS_NAME,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { DEFAULT_TIME_ZONE } from "@/i18n/time-zone";
import {
  type ActionError,
  toActionRejectionError,
} from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import {
  cancelProjectSocialPost,
  duplicateProjectSocialPost,
  publishProjectSocialPost,
} from "@/lib/actions/project/action";
import { getDefaultTimezone } from "@/lib/schedules/timezones";
import {
  clearSocialComposePrefill,
  peekSocialComposePrefill,
} from "@/lib/social-compose-prefill";
import { cn } from "@/lib/utils";
import { loadMoreSocialPosts } from "./actions";
import {
  SECTION_ORDER,
  SECTION_STATUSES,
  type SectionKey,
  SOCIAL_TABS,
  type SocialTab,
} from "./constants";
import {
  accountChipLabel,
  formatComposerHandle,
} from "./social-post-account-chip-label";
import { socialPostCreatorLabel } from "./social-post-creator-label";
import { SocialPostMediaThumb } from "./social-post-media-thumb";
import { SocialPostMetrics } from "./social-post-metrics";
import { SocialPostPreview } from "./social-post-preview";
import { SocialPostPreviewDialog } from "./social-post-preview-dialog";
import { publishFailureCopy } from "./social-post-publish-failure";
import { SocialPostStatistics } from "./social-post-statistics";
import { getSocialReconnections } from "./social-reconnection";

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
  /** Closing or closed projects cannot reconnect accounts. */
  connectDisabled?: boolean;
  managedConnections?: ProjectSocialConnection[];
  affectedPosts?: SocialPost[];
  /** The Accounts first page failed, so do not pretend there are none. */
  accountsFailed?: boolean;
  /** The Calendar first page failed, so do not pretend there are no posts. */
  calendarFailed?: boolean;
  posts: SocialPost[];
  /** List tabs whose first page failed to load. */
  failedSections?: readonly SectionKey[];
  nextCursors?: Partial<Record<SectionKey, string | null>>;
  projectId: string;
  /** Render only the post dialog and its actions for an unscoped calendar. */
  previewOnly?: boolean;
  returnFocus?: () => void;
  /**
   * The post a link names (`?postId=`), opened in a preview without changing tabs.
   */
  selectedPostId?: string;
  /** The same `?postId=` even when that post is gone, so the page can say so. */
  requestedPostId?: string;
  /** The named post request failed, so do not pretend the link is gone. */
  selectedPostFailed?: boolean;
}

/** Statuses whose previous attempt already ran, so the publish action reads as a retry. */
const RETRY_STATUSES: readonly SocialPostStatus[] = ["FAILED", "MISSED"];

function canRetryPost(post: SocialPost): boolean {
  return RETRY_STATUSES.includes(post.status) && post.canPublishNow;
}

function retryLabel(post: SocialPost): string {
  const text = post.text.trim();
  if (text) return text.length > 48 ? `${text.slice(0, 47)}…` : text;
  return post.socialConnection?.externalHandle ?? post.provider;
}

interface BulkRetryResult {
  postId: string;
  label: string;
  ok: boolean;
  error?: string;
}
type LoadMoreErrorKind = "offline" | "timeout" | "failed";

const LOAD_MORE_ERROR_COPY = {
  offline: "loadMoreOffline",
  timeout: "loadMoreTimeout",
  failed: "loadMoreError",
} as const;

function timeOf(value: Date | null): number {
  return value ? new Date(value).getTime() : 0;
}

function sectionOf(post: SocialPost): SectionKey | undefined {
  return SECTION_ORDER.find((section) =>
    SECTION_STATUSES[section].includes(post.status),
  );
}

function sortSection(posts: SocialPost[], section: SectionKey): SocialPost[] {
  if (section === "attention") {
    return [...posts].sort(
      (a, b) =>
        timeOf(b.lastAttemptAt) - timeOf(a.lastAttemptAt) ||
        timeOf(b.scheduledAt) - timeOf(a.scheduledAt) ||
        b.id.localeCompare(a.id),
    );
  }
  return [...posts].sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt));
}

/** Same `yyyy-MM-dd` WorkspaceCalendar reads from `?date=`. */
function calendarDateParam(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }
  return `${values.year}-${values.month}-${values.day}`;
}

function actionSubject(post: SocialPost, untitled: string): string {
  const handle = formatComposerHandle(
    post.socialConnection?.externalHandle ?? null,
  );
  if (handle) return handle;
  const name = post.socialConnection?.displayName?.trim();
  if (name) return name;
  return untitled;
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

function previewAccountFor(
  post: SocialPost,
  connections: ProjectSocialConnection[],
) {
  const connection = post.socialConnection;
  if (!connection) return null;
  return {
    handle: connection.externalHandle,
    displayName: connection.displayName,
    avatarUrl:
      connections.find((candidate) => candidate.id === connection.id)
        ?.avatarUrl ?? connection.avatarUrl,
  };
}

/** Same boxes as a list row so Load more does not jump the page. */
function SocialPostRowSkeleton() {
  return (
    <li
      aria-hidden
      className="bg-background border-border flex items-start gap-3 rounded-lg border p-3"
      data-testid="social-post-row-skeleton"
    >
      <Skeleton className="size-9 shrink-0 rounded-md" />
      <div className="min-w-48 flex-1 space-y-1.5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-3 w-24" />
      </div>
    </li>
  );
}

export function ProjectSocialPosts({
  accounts,
  accountCount,
  connectDisabled = false,
  managedConnections,
  affectedPosts = [],
  accountsFailed = false,
  actions,
  calendar,
  calendarFailed = false,
  connections,
  posts: initialPosts,
  failedSections = [],
  nextCursors,
  projectId,
  selectedPostId,
  requestedPostId,
  selectedPostFailed = false,
  previewOnly = false,
  returnFocus,
}: ProjectSocialPostsProps) {
  const router = useRouter();
  const accountsHref = `/social?projectId=${encodeURIComponent(projectId)}&tab=accounts`;
  const t = useTranslations("App.Projects.SocialPosts");
  const formatter = useFormatter();
  const displayTimezone = useTimeZone() ?? DEFAULT_TIME_ZONE;
  const [syncedPosts, setSyncedPosts] = useState(initialPosts);
  const [posts, setPosts] = useState(initialPosts);
  const [cursors, setCursors] = useState(nextCursors ?? {});
  const [loadingSection, setLoadingSection] = useState<SectionKey | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<{
    section: SectionKey;
    kind: LoadMoreErrorKind;
  } | null>(null);
  const [tabParam, setTabParam] = useQueryState(
    "tab",
    parseAsStringLiteral(SOCIAL_TABS),
  );
  const [provider, setProvider] = useQueryState(
    "provider",
    parseAsStringEnum<ProjectSocialProviderValue>(SOCIAL_POST_PROVIDERS),
  );
  const [timezone] = useQueryState("timezone", parseAsString);
  const [, setDate] = useQueryState("date", parseAsString);
  const sourceRef = useRef(initialPosts);
  sourceRef.current = initialPosts;
  if (syncedPosts !== initialPosts) {
    setSyncedPosts(initialPosts);
    setPosts(initialPosts);
    setCursors(nextCursors ?? {});
    setLoadMoreError(null);
  }
  const [composer, setComposer] = useState<SocialPostComposerMode | null>(null);
  // Social's top-level New post menu opens a fresh composer through context.
  const compose = useSocialCompose();
  const composerMode: SocialPostComposerMode | null =
    composer ??
    (compose?.open
      ? ({
          kind: "create",
          ...peekSocialComposePrefill(projectId),
        } satisfies SocialPostComposerMode)
      : null);
  const [cancelTarget, setCancelTarget] = useState<SocialPost | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [publishTarget, setPublishTarget] = useState<SocialPost | null>(null);
  const [publishPending, setPublishPending] = useState(false);
  const [duplicatePending, setDuplicatePending] = useState(false);
  const [selectedRetryIds, setSelectedRetryIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [bulkRetryOpen, setBulkRetryOpen] = useState(false);
  const [bulkRetryPending, setBulkRetryPending] = useState(false);
  const [bulkRetryResults, setBulkRetryResults] = useState<
    BulkRetryResult[] | null
  >(null);
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

  useEffect(() => {
    // A failed load is not a missing post; the inline error says so instead.
    if (!requestedPostId || selectedPostId || selectedPostFailed) return;
    toast.error(t("toasts.missingPost"), {
      duration: Infinity,
      closeButton: true,
    });
  }, [requestedPostId, selectedPostId, selectedPostFailed, t]);

  function handleCloseAutoFocus(event: Event) {
    if (!returnFocus) return;
    event.preventDefault();
    if (!composerMode && !cancelTarget && !publishTarget && !bulkRetryOpen)
      returnFocus();
  }

  function postsIn(section: SectionKey): SocialPost[] {
    return sortSection(
      posts.filter((post) => SECTION_STATUSES[section].includes(post.status)),
      section,
    );
  }

  const [reconnectedAccounts, setReconnectedAccounts] = useState<
    ProjectSocialConnection[]
  >([]);
  const [retryPosts, setRetryPosts] = useState<SocialPost[]>([]);
  const [retryPending, setRetryPending] = useState(false);
  const managed = (managedConnections ?? connections).map(
    (connection) =>
      reconnectedAccounts.find((next) => next.id === connection.id) ??
      connection,
  );
  const allAffectedPosts = posts.reduce(upsertPost, affectedPosts);
  const reconnections = getSocialReconnections(managed, allAffectedPosts);

  function handleReconnected(connection: ProjectSocialConnection): void {
    const failedPosts =
      reconnections
        .find((item) => item.connection.id === connection.id)
        ?.affectedPosts.filter((post) => post.status === "FAILED") ?? [];
    setReconnectedAccounts((current) => [
      ...current.filter((item) => item.id !== connection.id),
      connection,
    ]);
    setRetryPosts(failedPosts);
  }

  async function handleRetryReconnected(): Promise<void> {
    if (retryPending) return;
    setRetryPending(true);
    const remaining: SocialPost[] = [];
    try {
      for (const target of retryPosts) {
        try {
          const result = await publishProjectSocialPost({
            projectId,
            postId: target.id,
            revision: target.revision,
          });
          if (!result.ok) {
            handleActionError(result.error);
            remaining.push(target);
          } else {
            setPosts((current) => upsertPost(current, result.value));
            if (result.value.status !== "PUBLISHED") {
              remaining.push(result.value);
              toast.error(
                t("toasts.publishFailed", {
                  error: publishFailureCopy(result.value, t),
                }),
              );
            }
          }
        } catch (error) {
          handleActionError(toActionRejectionError(error), error);
          remaining.push(target);
        }
      }
      setRetryPosts(remaining);
      router.refresh();
    } finally {
      setRetryPending(false);
    }
  }

  // Needs attention is a tab only while something needs it. Once the last
  // post in it is dealt with, the page goes back to its first tab.
  const hasCalendar = calendar !== undefined || calendarFailed;
  const tabs: SocialTab[] = SOCIAL_TABS.filter((candidate) => {
    if (candidate === "calendar") return hasCalendar;
    if (candidate === "accounts") return accounts !== undefined;
    return (
      candidate !== "attention" ||
      postsIn(candidate).length > 0 ||
      reconnections.length > 0 ||
      Boolean(cursors[candidate]) ||
      failedSections.includes(candidate)
    );
  });
  const tab: SocialTab =
    tabParam && tabs.includes(tabParam) ? tabParam : tabs[0];
  const listedAccountCount = accountCount ?? connections.length;
  const accountPrompt =
    accounts === undefined || tab === "accounts" || accountsFailed
      ? null
      : listedAccountCount === 0
        ? "connect"
        : connections.length === 0 &&
            !(tab === "attention" && reconnections.length > 0)
          ? "reconnect"
          : null;
  const retryablePosts = postsIn("attention").filter(
    (post) =>
      canRetryPost(post) && (provider === null || post.provider === provider),
  );
  const selectedRetryablePosts = retryablePosts.filter((post) =>
    selectedRetryIds.has(post.id),
  );
  const allRetryableSelected =
    retryablePosts.length > 0 &&
    selectedRetryablePosts.length === retryablePosts.length;
  const someRetryableSelected = selectedRetryablePosts.length > 0;

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
    setLoadMoreError(null);
    try {
      const page = await loadMoreSocialPosts({ projectId, section, cursor });
      if (sourceRef.current !== source) return;
      setPosts((current) => page.posts.reduce(upsertPost, current));
      setCursors((current) => ({ ...current, [section]: page.nextCursor }));
    } catch (error) {
      setLoadMoreError({
        section,
        kind: isBrowserOffline()
          ? "offline"
          : isTimeoutRejection(error)
            ? "timeout"
            : "failed",
      });
    } finally {
      setLoadingSection(null);
    }
  }

  function handleSaved(post: SocialPost): void {
    setPosts((current) => upsertPost(current, post));
    // Follow the post to the list that still shows it. A failed or missed
    // post that just left that list should not yank the page to the calendar
    // while other posts still need attention.
    // Calendar entries are server-rendered, so refresh after every save.
    router.refresh();
    const nextSection = sectionOf(post);
    const previous = posts.find((candidate) => candidate.id === post.id);
    const attentionRemains = posts.some(
      (candidate) =>
        candidate.id !== post.id &&
        SECTION_STATUSES.attention.includes(candidate.status),
    );
    const stayOnAttention =
      previous !== undefined &&
      RETRY_STATUSES.includes(previous.status) &&
      attentionRemains;
    const openCalendar =
      nextSection === undefined &&
      (previewOnly || (hasCalendar && !stayOnAttention));
    if (openCalendar && post.scheduledAt) {
      const zone =
        timezone && isValidTimezone(timezone) ? timezone : getDefaultTimezone();
      void setDate(calendarDateParam(post.scheduledAt, zone));
    }
    if (previewOnly) {
      return;
    }
    if (nextSection) {
      showTab(nextSection);
      return;
    }
    if (stayOnAttention) {
      return;
    }
    showTab(hasCalendar ? "calendar" : null);
  }

  async function handleDuplicate(post: SocialPost): Promise<void> {
    if (duplicatePending) return;
    setDuplicatePending(true);
    try {
      const result = await duplicateProjectSocialPost({
        projectId,
        postId: post.id,
      });
      if (!result.ok) {
        handleActionError(result.error);
        return;
      }
      handleSaved(result.value);
      toast.success(t("toasts.duplicated"));
    } catch (error) {
      handleActionError(toActionRejectionError(error), error);
    } finally {
      setDuplicatePending(false);
    }
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
      toast.success(
        t(
          RETRY_STATUSES.includes(target.status)
            ? "toasts.dismissed"
            : "toasts.canceled",
        ),
      );
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
      } else if (post.lastError || post.lastAttempt?.errorKind) {
        const error = publishFailureCopy(post, t) ?? t("toasts.failed");
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

  function toggleRetrySelection(postId: string, selected: boolean): void {
    setSelectedRetryIds((current) => {
      const next = new Set(current);
      if (selected) next.add(postId);
      else next.delete(postId);
      return next;
    });
  }

  function toggleRetryAll(selected: boolean): void {
    setSelectedRetryIds(
      selected ? new Set(retryablePosts.map((post) => post.id)) : new Set(),
    );
  }

  async function handleConfirmBulkRetry(): Promise<void> {
    const targets = selectedRetryablePosts;
    if (targets.length === 0 || bulkRetryPending) return;
    setBulkRetryPending(true);
    const results: BulkRetryResult[] = [];
    const updated: SocialPost[] = [];
    let sawConflict = false;
    for (const post of targets) {
      try {
        const result = await publishProjectSocialPost({
          projectId,
          postId: post.id,
          revision: post.revision,
        });
        if (!result.ok) {
          if (result.error.code === CommonErrorCode.UNAUTHENTICATED) {
            handleActionError(result.error);
            break;
          }
          if (isRevisionConflict(result.error)) {
            sawConflict = true;
            results.push({
              postId: post.id,
              label: retryLabel(post),
              ok: false,
              error: t("toasts.conflict"),
            });
            continue;
          }
          results.push({
            postId: post.id,
            label: retryLabel(post),
            ok: false,
            error: result.error.message || t("toasts.failed"),
          });
          continue;
        }
        const next = result.value;
        updated.push(next);
        if (next.status === "PUBLISHED") {
          results.push({
            postId: post.id,
            label: retryLabel(post),
            ok: true,
          });
          continue;
        }
        results.push({
          postId: post.id,
          label: retryLabel(post),
          ok: false,
          error: publishFailureCopy(next, t) ?? t("toasts.failed"),
        });
      } catch (error) {
        const actionError = toActionRejectionError(error);
        if (actionError.code === CommonErrorCode.UNAUTHENTICATED) {
          handleActionError(actionError);
          break;
        }
        results.push({
          postId: post.id,
          label: retryLabel(post),
          ok: false,
          error: actionError.message || t("toasts.failed"),
        });
      }
    }
    if (updated.length > 0) {
      setPosts((current) => updated.reduce(upsertPost, current));
    }
    setSelectedRetryIds(new Set());
    setBulkRetryResults(results);
    setBulkRetryPending(false);
    if (sawConflict) router.refresh();
  }

  function renderPostActions(post: SocialPost, preview = false) {
    const isRetry = RETRY_STATUSES.includes(post.status);
    // A post that failed or missed its time has one thing left to do, so
    // Retry sits on the row, the way Reconnect does on a Social account.
    const canRetry = isRetry && post.canPublishNow;
    const canPublishNow = !isRetry && post.canPublishNow;
    // Preview footer already has Edit and Schedule. Keep the menu for
    // Publish now and Cancel, and hide it when those are gone.
    const showComposeInMenu = !preview;
    const hasMenu =
      canPublishNow ||
      (showComposeInMenu && post.canEdit) ||
      (showComposeInMenu && post.canSchedule) ||
      post.canCancel ||
      post.canDuplicate;
    const subject = actionSubject(post, t("thisDraft"));
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
            className="size-11 md:size-10"
            aria-label={t("preview.openNamed", { handle: subject })}
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
            className="h-11 md:h-8"
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
                className="size-11 md:size-10"
                aria-label={t("moreActionsNamed", { handle: subject })}
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canPublishNow ? (
                <DropdownMenuItem
                  className="min-h-11"
                  onSelect={() => {
                    if (preview) setPreviewOpen(false);
                    setPublishTarget(post);
                  }}
                >
                  {t("actions.publishNow")}
                </DropdownMenuItem>
              ) : null}
              {showComposeInMenu && post.canEdit ? (
                <DropdownMenuItem
                  className="min-h-11"
                  onSelect={() => {
                    setComposer({ kind: "edit", post });
                  }}
                >
                  {t("composer.edit")}
                </DropdownMenuItem>
              ) : null}
              {showComposeInMenu && post.canSchedule ? (
                <DropdownMenuItem
                  className="min-h-11"
                  onSelect={() => {
                    setComposer({ kind: "schedule", post });
                  }}
                >
                  {post.status === "SCHEDULED" || isRetry
                    ? t("composer.reschedule")
                    : t("composer.schedule")}
                </DropdownMenuItem>
              ) : null}
              {post.canDuplicate ? (
                <DropdownMenuItem
                  className="min-h-11"
                  onSelect={() => {
                    if (preview) setPreviewOpen(false);
                    void handleDuplicate(post);
                  }}
                >
                  {t("actions.duplicate")}
                </DropdownMenuItem>
              ) : null}
              {post.canCancel ? (
                <DropdownMenuItem
                  className="min-h-11"
                  variant="destructive"
                  onSelect={() => {
                    if (preview) setPreviewOpen(false);
                    setCancelTarget(post);
                  }}
                >
                  {isRetry ? t("actions.dismiss") : t("composer.cancel")}
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
  const cancelCopy =
    cancelTarget && RETRY_STATUSES.includes(cancelTarget.status)
      ? "dismissDialog"
      : "cancelDialog";

  function renderReconnectWarning(post: SocialPost) {
    if (!post.connectionNeedsReconnect) return null;
    return (
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
            href={accountsHref}
          >
            {t("needsReconnectLink")}
          </Link>
        )}
      </p>
    );
  }

  function renderDraft(post: SocialPost) {
    function openPreview() {
      setPreviewTarget(post);
      setPreviewOpen(true);
    }

    return (
      <li
        key={post.id}
        id={`social-post-${post.id}`}
        className="flex h-full min-w-0 flex-col gap-2"
        data-testid={`social-post-${post.id}`}
      >
        <SocialPostPreview
          account={previewAccountFor(post, connections)}
          compact
          media={post.media}
          onSeeMore={openPreview}
          provider={post.provider}
          text={post.text}
          timestamp={null}
        />
        {post.status === "PUBLISHING" ? (
          <SocialPostStatusBadge
            label={t("status.PUBLISHING")}
            status={post.status}
          />
        ) : null}
        {renderReconnectWarning(post)}
        <div className="mt-auto">{renderPostActions(post)}</div>
      </li>
    );
  }

  function renderPost(post: SocialPost) {
    const accountLabel = accountChipLabel(
      post.socialConnection,
      t("noAccount"),
    );
    const creatorLabel = socialPostCreatorLabel(
      post.creator,
      t(`creator.${post.creator.kind}`),
    );
    const failedAt = post.lastAttempt?.finishedAt ?? null;
    const leadingAt =
      post.status === "FAILED" && failedAt ? failedAt : post.scheduledAt;
    const failureReason =
      post.status === "FAILED" || post.status === "MISSED"
        ? publishFailureCopy(post, t)
        : null;

    const retryable = canRetryPost(post);
    return (
      <li
        key={post.id}
        id={`social-post-${post.id}`}
        // The Task board's card: one border weight, the primary border on
        // hover, and the status badge leading like a task's.
        className="bg-background border-border flex flex-wrap items-start gap-3 rounded-lg border p-3 transition-[border-color,box-shadow] hover:border-primary hover:shadow-sm"
        data-testid={`social-post-${post.id}`}
      >
        {retryable ? (
          <Checkbox
            aria-label={t("bulkRetry.selectPost")}
            checked={selectedRetryIds.has(post.id)}
            className="mt-2.5"
            data-testid={`social-post-select-${post.id}`}
            onCheckedChange={(value) =>
              toggleRetrySelection(post.id, value === true)
            }
          />
        ) : null}
        <span
          aria-hidden
          className="bg-background flex size-9 shrink-0 items-center justify-center rounded-md border"
        >
          <SocialPostProviderIcon provider={post.provider} className="size-5" />
        </span>
        <div className="min-w-48 flex-1 space-y-1.5">
          <p className="text-muted-foreground flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            {leadingAt ? (
              <time
                className="text-foreground font-medium whitespace-nowrap tabular-nums"
                dateTime={leadingAt.toISOString()}
              >
                {/* Named, so a reader in another zone does not misread it. */}
                {formatter.dateTime(leadingAt, "dateTime")}{" "}
                <TimezoneLabel
                  timeZone={displayTimezone}
                  at={leadingAt}
                  variant="short"
                />
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
          {renderReconnectWarning(post)}
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
          {(post.status === "FAILED" || post.status === "MISSED") &&
          (failureReason || failedAt) ? (
            <div className="space-y-0.5 text-xs">
              {failureReason ? (
                <p
                  className={
                    post.status === "FAILED"
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }
                >
                  {failureReason}
                </p>
              ) : null}
              {post.status === "MISSED" && failedAt ? (
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
        </div>
        {renderPostActions(post)}
      </li>
    );
  }

  return (
    <section className="space-y-4" data-testid="project-social-posts">
      <AlertDialog
        open={retryPosts.length > 0}
        onOpenChange={(open) => {
          if (!open && !retryPending) setRetryPosts([]);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("reconnection.retryTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("reconnection.retryDescription", { count: retryPosts.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={retryPending}>
              {t("reconnection.later")}
            </AlertDialogCancel>
            <AlertDialogAction
              loading={retryPending}
              onClick={(event) => {
                event.preventDefault();
                void handleRetryReconnected();
              }}
            >
              {t("actions.retry")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
          <div className="flex flex-row items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <TabsList
                aria-label={t("title")}
                className={cn(
                  SEGMENTED_TABS_LIST_CLASS_NAME,
                  "app-scrollbar w-fit min-w-0 max-w-full max-sm:justify-start max-sm:overflow-x-auto",
                )}
              >
                {tabs.map((candidate) => {
                  const count =
                    candidate === "drafts" || candidate === "attention"
                      ? postsIn(candidate).length +
                        (candidate === "attention" ? reconnections.length : 0)
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
            </div>
            {tab === "drafts" || tab === "attention" ? (
              <SocialPlatformFilter
                value={provider}
                onChange={(next) => {
                  void setProvider(next);
                }}
              />
            ) : null}
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
                className="h-11 shrink-0 md:h-8"
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

          {/* A slim line, not a card: the tabs below still work. */}
          {selectedPostFailed ? (
            <SocialLoadError
              data-testid="social-selected-post-load-error"
              kind="post"
              variant="banner"
            />
          ) : null}

          {hasCalendar ? (
            <TabsContent
              data-testid="social-posts-section-calendar"
              value="calendar"
            >
              {calendarFailed ? (
                <SocialLoadError
                  data-testid="social-calendar-load-error"
                  kind="calendar"
                />
              ) : (
                calendar
              )}
            </TabsContent>
          ) : null}

          {SECTION_ORDER.filter((section) => tabs.includes(section)).map(
            (section) => {
              const sectionPosts = postsIn(section).filter(
                (post) => provider === null || post.provider === provider,
              );
              const sectionReconnections =
                section === "attention"
                  ? reconnections.filter(
                      ({ connection }) =>
                        provider === null || connection.provider === provider,
                    )
                  : [];
              const cursor = cursors[section];
              return (
                <TabsContent
                  key={section}
                  className="space-y-3"
                  data-testid={`social-posts-section-${section}`}
                  value={section}
                >
                  {sectionReconnections.length > 0 ? (
                    <ProjectSocialAccounts
                      connections={managed}
                      connectDisabled={connectDisabled}
                      projectId={projectId}
                      reconnections={sectionReconnections}
                      onReconnected={handleReconnected}
                    />
                  ) : null}
                  {section === "attention" && retryablePosts.length > 0 ? (
                    <div
                      className="flex flex-wrap items-center gap-3"
                      data-testid="social-bulk-retry"
                    >
                      <Checkbox
                        aria-label={t("bulkRetry.selectAll")}
                        checked={
                          allRetryableSelected
                            ? true
                            : someRetryableSelected
                              ? "indeterminate"
                              : false
                        }
                        data-testid="social-bulk-retry-select-all"
                        onCheckedChange={(value) =>
                          toggleRetryAll(value === true)
                        }
                      />
                      <span className="text-muted-foreground text-sm tabular-nums">
                        {t("bulkRetry.selected", {
                          count: selectedRetryablePosts.length,
                        })}
                      </span>
                      <Button
                        className="ms-auto"
                        disabled={
                          selectedRetryablePosts.length === 0 ||
                          bulkRetryPending
                        }
                        size="sm"
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setBulkRetryResults(null);
                          setBulkRetryOpen(true);
                        }}
                      >
                        <RotateCcw className="size-4" aria-hidden />
                        {t("bulkRetry.retrySelected")}
                      </Button>
                    </div>
                  ) : null}
                  {/* A linked post can still show while its list failed:
                      keep the retry, as a slim line above it. */}
                  {failedSections.includes(section) &&
                  sectionPosts.length > 0 ? (
                    <SocialLoadError
                      data-testid={`social-posts-load-error-${section}`}
                      kind={section}
                      variant="banner"
                    />
                  ) : null}
                  {failedSections.includes(section) &&
                  sectionPosts.length === 0 ? (
                    <SocialLoadError
                      data-testid={`social-posts-load-error-${section}`}
                      kind={section}
                    />
                  ) : sectionPosts.length > 0 || loadingSection === section ? (
                    <ul
                      className={
                        section === "drafts"
                          ? "grid items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3"
                          : "grid gap-2"
                      }
                      data-testid={
                        section === "drafts"
                          ? "social-posts-drafts-grid"
                          : undefined
                      }
                    >
                      {sectionPosts.map(
                        section === "drafts" ? renderDraft : renderPost,
                      )}
                      {loadingSection === section ? (
                        <>
                          <SocialPostRowSkeleton />
                          <SocialPostRowSkeleton />
                        </>
                      ) : null}
                    </ul>
                  ) : cursor || sectionReconnections.length > 0 ? null : (
                    <EmptyState
                      description={t(`emptyHint.${section}`)}
                      icon={FileText}
                      title={t(`empty.${section}`)}
                    />
                  )}
                  {sectionPosts.length === 0 && cursor ? (
                    <p className="text-muted-foreground text-sm">
                      {t("empty.more")}
                    </p>
                  ) : null}
                  {cursor ? (
                    <div className="space-y-2">
                      {loadMoreError?.section === section ? (
                        <p
                          className="text-destructive text-sm"
                          data-testid="social-load-more-error"
                          role="alert"
                        >
                          {t(LOAD_MORE_ERROR_COPY[loadMoreError.kind])}
                        </p>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-11 md:h-8"
                        disabled={
                          loadingSection !== null && loadingSection !== section
                        }
                        loading={loadingSection === section}
                        onClick={() => {
                          void handleLoadMore(section);
                        }}
                      >
                        {t("loadMore")}
                      </Button>
                    </div>
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
              {accountsFailed ? (
                <SocialLoadError
                  data-testid="social-accounts-load-error"
                  kind="accounts"
                />
              ) : (
                accounts
              )}
            </TabsContent>
          ) : null}
        </Tabs>
      ) : null}

      {composerMode ? (
        <SocialPostComposerDialog
          connections={connections}
          mode={composerMode}
          onConnectAccount={() => {
            setComposer(null);
            compose?.setOpen(false);
            if (accounts !== undefined) {
              showTab("accounts");
              return;
            }
            router.push(accountsHref);
          }}
          onCloseAutoFocus={handleCloseAutoFocus}
          onError={handleActionError}
          onOpenChange={(open) => {
            if (open) return;
            setComposer(null);
            compose?.setOpen(false);
            clearSocialComposePrefill(projectId);
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
            <AlertDialogTitle>{t(`${cancelCopy}.title`)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(`${cancelCopy}.description`)}
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
              {t(`${cancelCopy}.confirm`)}
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

      <AlertDialog
        open={bulkRetryOpen}
        onOpenChange={(open) => {
          if (!open && !bulkRetryPending) {
            setBulkRetryOpen(false);
            setBulkRetryResults(null);
          }
        }}
      >
        <AlertDialogContent
          className="max-h-[min(40rem,calc(100dvh-2rem))] overflow-y-auto overscroll-contain"
          onCloseAutoFocus={handleCloseAutoFocus}
        >
          {bulkRetryResults ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("bulkRetry.resultsTitle")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("bulkRetry.description")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <ul
                className="grid gap-2 text-sm"
                data-testid="social-bulk-retry-results"
              >
                {bulkRetryResults.map((result) => (
                  <li
                    key={result.postId}
                    className="flex flex-col gap-0.5"
                    data-testid={`social-bulk-retry-result-${result.postId}`}
                  >
                    <span className="text-foreground min-w-0 truncate">
                      {result.label}
                    </span>
                    <span
                      className={
                        result.ok ? "text-muted-foreground" : "text-destructive"
                      }
                    >
                      {result.ok
                        ? t("bulkRetry.published")
                        : (result.error ?? t("toasts.failed"))}
                    </span>
                  </li>
                ))}
              </ul>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("composer.close")}</AlertDialogCancel>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("bulkRetry.title")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("bulkRetry.description")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={bulkRetryPending}>
                  {t("composer.close")}
                </AlertDialogCancel>
                <AlertDialogAction
                  loading={bulkRetryPending}
                  onClick={(event) => {
                    event.preventDefault();
                    void handleConfirmBulkRetry();
                  }}
                >
                  {t("bulkRetry.confirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
