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
  MoreHorizontal,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { SocialPostComposerMode } from "@/app/projects/components/social-posts/social-post-composer-dialog";
import { SocialPostComposerDialog } from "@/app/projects/components/social-posts/social-post-composer-dialog";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import { useSocialCompose } from "@/app/social/components/social-compose-context";
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
import { SECTION_ORDER, SECTION_STATUSES, type SectionKey } from "./constants";

interface ProjectSocialPostsProps {
  /** Active connections only; drives the account picker. */
  connections: ProjectSocialConnection[];
  posts: SocialPost[];
  nextCursors?: Partial<Record<SectionKey, string | null>>;
  projectId: string;
  /**
   * The post a link names (`?postId=`). Its tab opens first. A published or
   * canceled post has no tab, so it is shown above the tabs instead.
   */
  selectedPostId?: string;
}

/** Statuses whose previous attempt already ran, so the publish action reads as a retry. */
const RETRY_STATUSES: readonly SocialPostStatus[] = ["FAILED", "MISSED"];

/** Statuses the tab already names, so a badge on the row would only repeat it. */
const TAB_STATUSES: readonly SocialPostStatus[] = ["SCHEDULED", "DRAFT"];

function timeOf(value: Date | null): number {
  return value ? new Date(value).getTime() : 0;
}

function sectionOf(post: SocialPost): SectionKey | undefined {
  return SECTION_ORDER.find((section) =>
    SECTION_STATUSES[section].includes(post.status),
  );
}

function tabFor(posts: SocialPost[], postId: string | undefined): SectionKey {
  const post = posts.find((candidate) => candidate.id === postId);
  return (post && sectionOf(post)) ?? "upcoming";
}

function sortSection(section: SectionKey, posts: SocialPost[]): SocialPost[] {
  if (section === "upcoming") {
    return [...posts].sort(
      (a, b) => timeOf(a.scheduledAt) - timeOf(b.scheduledAt),
    );
  }
  return [...posts].sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt));
}

function formatHandle(handle: string | null): string | null {
  if (!handle) return null;
  return handle.startsWith("@") ? handle : `@${handle}`;
}

function isRevisionConflict(error: ActionError): boolean {
  return error.kind === CORE_API_ERROR_KINDS.SOCIAL_POST_REVISION_CONFLICT;
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
      className="bg-card-background press hover:bg-card-background-hover focus-visible:ring-ring relative block size-12 shrink-0 overflow-hidden rounded-xl border outline-none transition"
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
  connections,
  posts: initialPosts,
  nextCursors,
  projectId,
  selectedPostId,
}: ProjectSocialPostsProps) {
  const router = useRouter();
  const t = useTranslations("App.Projects.SocialPosts");
  const formatter = useFormatter();
  const [syncedPosts, setSyncedPosts] = useState(initialPosts);
  const [posts, setPosts] = useState(initialPosts);
  const [cursors, setCursors] = useState(nextCursors ?? {});
  const [loadingSection, setLoadingSection] = useState<SectionKey | null>(null);
  const [syncedSelectedPostId, setSyncedSelectedPostId] =
    useState(selectedPostId);
  const [tab, setTab] = useState(() => tabFor(initialPosts, selectedPostId));
  const sourceRef = useRef(initialPosts);
  sourceRef.current = initialPosts;
  if (syncedPosts !== initialPosts) {
    setSyncedPosts(initialPosts);
    setPosts(initialPosts);
    setCursors(nextCursors ?? {});
  }
  // A link to another post opens the tab that lists it.
  if (syncedSelectedPostId !== selectedPostId) {
    setSyncedSelectedPostId(selectedPostId);
    setTab(tabFor(initialPosts, selectedPostId));
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

  const accountsHref = "#social-accounts";

  function postsIn(section: SectionKey): SocialPost[] {
    return sortSection(
      section,
      posts.filter((post) => SECTION_STATUSES[section].includes(post.status)),
    );
  }

  // Needs attention is a tab only while something needs it. Once the last
  // post in it is dealt with, the list goes back to Upcoming.
  const tabs = SECTION_ORDER.filter(
    (section) =>
      section !== "attention" ||
      postsIn(section).length > 0 ||
      Boolean(cursors[section]),
  );
  if (!tabs.includes(tab)) {
    setTab("upcoming");
  }
  const selectedUnlistedPost = posts.find(
    (post) => post.id === selectedPostId && !sectionOf(post),
  );

  function handleActionError(error: ActionError): void {
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
    // Follow the post to the tab that lists it now, so a new draft, a
    // scheduled draft or a failed publish stays in view.
    const section = sectionOf(post);
    if (section) setTab(section);
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
      handleActionError(toActionRejectionError(error));
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
    } finally {
      setPublishPending(false);
      setPublishTarget(null);
    }
  }

  function renderPost(post: SocialPost) {
    const handle = formatHandle(post.socialConnection?.externalHandle ?? null);
    const isRetry = RETRY_STATUSES.includes(post.status);
    // A post that failed or missed its time has one thing left to do, so
    // Retry sits on the row, the way Reconnect does on a Social account.
    const canRetry = isRetry && post.canPublishNow;
    const canPublishNow = !isRetry && post.canPublishNow;
    const hasMenu =
      canPublishNow || post.canEdit || post.canSchedule || post.canCancel;
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
        className="flex flex-wrap items-start gap-3 p-3"
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
                {formatter.dateTime(post.scheduledAt, "dateTime")}
              </time>
            ) : null}
            <span className="min-w-0 truncate">{handle ?? t("noAccount")}</span>
            {TAB_STATUSES.includes(post.status) ? null : (
              <SocialPostStatusBadge
                label={t(`status.${post.status}`)}
                status={post.status}
              />
            )}
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
              <Link
                className="font-medium underline-offset-4 hover:underline"
                href={accountsHref}
              >
                {t("needsReconnectLink")}
              </Link>
            </p>
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
        {canRetry || hasMenu ? (
          <div className="ms-auto flex items-center gap-2">
            {canRetry ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPublishTarget(post)}
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
                    <DropdownMenuItem onSelect={() => setPublishTarget(post)}>
                      {t("actions.publishNow")}
                    </DropdownMenuItem>
                  ) : null}
                  {post.canEdit ? (
                    <DropdownMenuItem
                      onSelect={() => setComposer({ kind: "edit", post })}
                    >
                      {t("composer.edit")}
                    </DropdownMenuItem>
                  ) : null}
                  {post.canSchedule ? (
                    <DropdownMenuItem
                      onSelect={() => setComposer({ kind: "schedule", post })}
                    >
                      {post.status === "SCHEDULED" || isRetry
                        ? t("composer.reschedule")
                        : t("composer.schedule")}
                    </DropdownMenuItem>
                  ) : null}
                  {post.canCancel ? (
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => setCancelTarget(post)}
                    >
                      {t("composer.cancel")}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        ) : null}
      </li>
    );
  }

  return (
    <section className="space-y-4" data-testid="project-social-posts">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">{t("title")}</h2>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>
      </div>

      {selectedUnlistedPost ? (
        <section
          aria-labelledby="social-posts-selected-heading"
          className="space-y-2"
          data-testid="social-posts-selected"
        >
          <h3
            id="social-posts-selected-heading"
            className="text-muted-foreground text-xs font-medium"
          >
            {t("selectedPost")}
          </h3>
          <ul className="rounded-lg border">
            {renderPost(selectedUnlistedPost)}
          </ul>
        </section>
      ) : null}

      <Tabs
        className="gap-3"
        value={tab}
        onValueChange={(value) => {
          const next = SECTION_ORDER.find((section) => section === value);
          if (next) setTab(next);
        }}
      >
        <TabsList
          aria-label={t("title")}
          className={cn(
            SEGMENTED_TABS_LIST_CLASS_NAME,
            "app-scrollbar w-fit max-w-full overflow-x-auto",
          )}
        >
          {tabs.map((section) => {
            const count = postsIn(section).length;
            return (
              <TabsTrigger
                key={section}
                className={SEGMENTED_TAB_TRIGGER_CLASS_NAME}
                data-testid={`social-posts-tab-${section}`}
                value={section}
              >
                {section === "attention" ? (
                  <AlertTriangle
                    className="text-semantic-warning size-4"
                    aria-hidden
                  />
                ) : null}
                {t(`sections.${section}`)}{" "}
                {count > 0 ? (
                  <span className="text-muted-foreground tabular-nums">
                    {cursors[section] ? `${count}+` : count}
                  </span>
                ) : null}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {tabs.map((section) => {
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
                <ul className="divide-y rounded-lg border">
                  {sectionPosts.map(renderPost)}
                </ul>
              ) : cursor ? null : (
                <div className="rounded-lg border border-dashed px-4 py-8 text-center">
                  <p className="text-sm font-medium">{t(`empty.${section}`)}</p>
                  <p className="text-muted-foreground mt-1 text-sm text-pretty">
                    {t(`emptyHint.${section}`)}
                  </p>
                </div>
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
                  {loadingSection === section ? t("loading") : t("loadMore")}
                </Button>
              ) : null}
            </TabsContent>
          );
        })}
      </Tabs>

      {composerMode ? (
        <SocialPostComposerDialog
          connections={connections}
          mode={composerMode}
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

      <AlertDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open && !cancelPending) setCancelTarget(null);
        }}
      >
        <AlertDialogContent>
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
              disabled={cancelPending}
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
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("publishDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("publishDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={publishPending}>
              {t("composer.close")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={publishPending}
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmPublish();
              }}
            >
              {t("publishDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
