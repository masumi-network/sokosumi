"use client";

import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import {
  AlertTriangle,
  CalendarClock,
  ExternalLink,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { SocialPostComposerMode } from "@/app/projects/components/social-posts/social-post-composer-dialog";
import { SocialPostComposerDialog } from "@/app/projects/components/social-posts/social-post-composer-dialog";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
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
  type ActionError,
  toActionRejectionError,
} from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import {
  cancelProjectSocialPost,
  publishProjectSocialPost,
} from "@/lib/actions/project/action";
import type {
  ProjectSocialConnection,
  SocialPost,
  SocialPostMediaRef,
  SocialPostStatus,
} from "@/lib/clients/generated/core/types.gen";
import { loadMoreSocialPosts } from "./actions";
import { SECTION_ORDER, SECTION_STATUSES, type SectionKey } from "./constants";

interface ProjectSocialPostsProps {
  /** Active connections only; drives the account picker. */
  connections: ProjectSocialConnection[];
  posts: SocialPost[];
  nextCursors?: Partial<Record<SectionKey, string | null>>;
  projectId: string;
}

/** Statuses whose previous attempt already ran, so the publish action reads as a retry. */
const RETRY_STATUSES: readonly SocialPostStatus[] = ["FAILED", "MISSED"];

function timeOf(value: Date | null): number {
  return value ? new Date(value).getTime() : 0;
}

function historyTimeOf(post: SocialPost): number {
  return timeOf(post.publishedAt ?? post.canceledAt ?? post.updatedAt);
}

function sortSection(section: SectionKey, posts: SocialPost[]): SocialPost[] {
  if (section === "upcoming") {
    return [...posts].sort(
      (a, b) => timeOf(a.scheduledAt) - timeOf(b.scheduledAt),
    );
  }
  if (section === "history") {
    return [...posts].sort((a, b) => historyTimeOf(b) - historyTimeOf(a));
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
      className="bg-card-background hover:bg-card-background-hover focus-visible:ring-ring relative block size-12 shrink-0 overflow-hidden rounded-xl border outline-none transition"
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
}: ProjectSocialPostsProps) {
  const router = useRouter();
  const t = useTranslations("App.Projects.SocialPosts");
  const formatter = useFormatter();
  const [syncedPosts, setSyncedPosts] = useState(initialPosts);
  const [posts, setPosts] = useState(initialPosts);
  const [cursors, setCursors] = useState(nextCursors ?? {});
  const [loadingSection, setLoadingSection] = useState<SectionKey | null>(null);
  const sourceRef = useRef(initialPosts);
  sourceRef.current = initialPosts;
  if (syncedPosts !== initialPosts) {
    setSyncedPosts(initialPosts);
    setPosts(initialPosts);
    setCursors(nextCursors ?? {});
  }
  const [composer, setComposer] = useState<SocialPostComposerMode | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SocialPost | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [publishTarget, setPublishTarget] = useState<SocialPost | null>(null);
  const [publishPending, setPublishPending] = useState(false);

  const accountsHref = "#social-accounts";

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
        toast.error(t("toasts.publishFailed", { error: post.lastError }));
      } else {
        toast.error(t("toasts.failed"));
      }
    } finally {
      setPublishPending(false);
      setPublishTarget(null);
    }
  }

  return (
    <section className="space-y-6" data-testid="project-social-posts">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">{t("title")}</h2>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => setComposer({ kind: "create" })}
        >
          <Plus className="size-4" aria-hidden />
          {t("newPost")}
        </Button>
      </div>

      {SECTION_ORDER.map((section) => {
        const sectionPosts = sortSection(
          section,
          posts.filter((post) =>
            SECTION_STATUSES[section].includes(post.status),
          ),
        );
        const headingId = `social-posts-${section}-heading`;

        return (
          <section
            key={section}
            aria-labelledby={headingId}
            className="space-y-2"
            data-testid={`social-posts-section-${section}`}
          >
            <h3
              id={headingId}
              className="text-muted-foreground text-xs font-medium"
            >
              {t(`sections.${section}`)}
            </h3>
            {sectionPosts.length === 0 ? (
              <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
                {t(`empty.${section}`)}
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {sectionPosts.map((post) => {
                  const handle = formatHandle(
                    post.socialConnection?.externalHandle ?? null,
                  );
                  const isRetry = RETRY_STATUSES.includes(post.status);
                  const hasActions =
                    post.canEdit ||
                    post.canSchedule ||
                    post.canCancel ||
                    post.canPublishNow;
                  const creatorLabel = post.creator.name
                    ? `${t(`creator.${post.creator.kind}`)} · ${post.creator.name}`
                    : t(`creator.${post.creator.kind}`);
                  const failedAt = post.lastAttempt?.finishedAt ?? null;

                  return (
                    <li
                      key={post.id}
                      className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start"
                      data-testid={`social-post-${post.id}`}
                    >
                      <span
                        aria-hidden
                        className="bg-background flex size-9 shrink-0 items-center justify-center rounded-md border text-sm font-semibold"
                      >
                        X
                      </span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-sm whitespace-pre-wrap break-words">
                          {post.text}
                        </p>
                        {post.media.length > 0 ? (
                          <div
                            className="flex flex-wrap items-center gap-1.5"
                            data-testid={`social-post-media-${post.id}`}
                          >
                            {post.media.map((ref) => (
                              <SocialPostMediaThumb
                                key={ref.pathname}
                                media={ref}
                              />
                            ))}
                          </div>
                        ) : null}
                        <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                          <span>{handle ?? t("noAccount")}</span>
                          {post.scheduledAt ? (
                            <span className="inline-flex items-center gap-1">
                              <CalendarClock className="size-3" aria-hidden />
                              <time dateTime={post.scheduledAt.toISOString()}>
                                {formatter.dateTime(
                                  post.scheduledAt,
                                  "dateTime",
                                )}
                              </time>
                            </span>
                          ) : null}
                          <span>{creatorLabel}</span>
                          {post.attemptCount > 0 ? (
                            <span>
                              {t("attempts", { count: post.attemptCount })}
                            </span>
                          ) : null}
                        </div>
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
                          <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                            {post.publishedAt ? (
                              <time dateTime={post.publishedAt.toISOString()}>
                                {t("publishedAt", {
                                  date: formatter.dateTime(
                                    post.publishedAt,
                                    "dateTime",
                                  ),
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
                                {t("viewOnX")}
                                <ExternalLink className="size-3" aria-hidden />
                              </a>
                            ) : null}
                          </div>
                        ) : null}
                        {post.status === "FAILED" ? (
                          <div className="space-y-0.5 text-xs">
                            {post.lastError ? (
                              <p className="text-destructive">
                                {post.lastError}
                              </p>
                            ) : null}
                            {failedAt ? (
                              <time
                                className="text-muted-foreground"
                                dateTime={failedAt.toISOString()}
                              >
                                {t("failedAt", {
                                  date: formatter.dateTime(
                                    failedAt,
                                    "dateTime",
                                  ),
                                })}
                              </time>
                            ) : null}
                          </div>
                        ) : null}
                        {post.status === "MISSED" && post.lastError ? (
                          <p className="text-muted-foreground text-xs">
                            {post.lastError}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2 sm:justify-end">
                        <SocialPostStatusBadge
                          label={t(`status.${post.status}`)}
                          status={post.status}
                        />
                        {hasActions ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={t("moreActions")}
                              >
                                <MoreHorizontal
                                  className="size-4"
                                  aria-hidden
                                />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {post.canPublishNow ? (
                                <DropdownMenuItem
                                  onSelect={() => setPublishTarget(post)}
                                >
                                  {isRetry
                                    ? t("actions.retry")
                                    : t("actions.publishNow")}
                                </DropdownMenuItem>
                              ) : null}
                              {post.canEdit ? (
                                <DropdownMenuItem
                                  onSelect={() =>
                                    setComposer({ kind: "edit", post })
                                  }
                                >
                                  {t("composer.edit")}
                                </DropdownMenuItem>
                              ) : null}
                              {post.canSchedule ? (
                                <DropdownMenuItem
                                  onSelect={() =>
                                    setComposer({ kind: "schedule", post })
                                  }
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
                    </li>
                  );
                })}
              </ul>
            )}
            {cursors[section] ? (
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
          </section>
        );
      })}

      {composer ? (
        <SocialPostComposerDialog
          connections={connections}
          mode={composer}
          onError={handleActionError}
          onOpenChange={(open) => {
            if (!open) setComposer(null);
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
