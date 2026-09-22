"use client";

import { CalendarClock, MoreHorizontal, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
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
import type { ActionError } from "@/lib/actions/errors/action-error";
import { cancelProjectSocialPost } from "@/lib/actions/project/action";
import type {
  ProjectSocialConnection,
  SocialPost,
  SocialPostStatus,
} from "@/lib/clients/generated/core/types.gen";

interface ProjectSocialPostsProps {
  /** Active connections only; drives the account picker and the empty state. */
  connections: ProjectSocialConnection[];
  posts: SocialPost[];
  projectId: string;
}

type SectionKey = "upcoming" | "drafts" | "history";

const SECTION_STATUSES: Record<SectionKey, readonly SocialPostStatus[]> = {
  upcoming: ["SCHEDULED", "PUBLISHING"],
  drafts: ["DRAFT"],
  history: ["PUBLISHED", "FAILED", "MISSED", "CANCELED"],
};

const SECTION_ORDER: SectionKey[] = ["upcoming", "drafts", "history"];

function timeOf(value: Date | null): number {
  return value ? new Date(value).getTime() : 0;
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
  return error.message?.toLowerCase().includes("modified") ?? false;
}

function upsertPost(posts: SocialPost[], next: SocialPost): SocialPost[] {
  const index = posts.findIndex((post) => post.id === next.id);
  if (index === -1) return [next, ...posts];
  return posts.map((post) => (post.id === next.id ? next : post));
}

export function ProjectSocialPosts({
  connections,
  posts: initialPosts,
  projectId,
}: ProjectSocialPostsProps) {
  const router = useRouter();
  const t = useTranslations("App.Projects.SocialPosts");
  const formatter = useFormatter();
  const [syncedPosts, setSyncedPosts] = useState(initialPosts);
  const [posts, setPosts] = useState(initialPosts);
  if (syncedPosts !== initialPosts) {
    setSyncedPosts(initialPosts);
    setPosts(initialPosts);
  }
  const [composer, setComposer] = useState<SocialPostComposerMode | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SocialPost | null>(null);
  const [cancelPending, setCancelPending] = useState(false);

  const hasConnections = connections.length > 0;

  function handleActionError(error: ActionError): void {
    if (isRevisionConflict(error)) {
      toast.error(t("toasts.conflict"));
      router.refresh();
      return;
    }
    toast.error(error.message || t("toasts.failed"));
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
    } finally {
      setCancelPending(false);
      setCancelTarget(null);
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

      {hasConnections ? null : (
        <div
          className="bg-card-background border-border space-y-2 rounded-xl border p-4"
          data-testid="social-posts-connect-callout"
          role="status"
        >
          <p className="text-sm">{t("connectAccountFirst")}</p>
          <Link
            className="text-primary text-sm font-medium underline-offset-4 hover:underline"
            href="#social-accounts"
          >
            {t("connectAccountLink")}
          </Link>
        </div>
      )}

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
                  const hasActions =
                    post.canEdit || post.canSchedule || post.canCancel;
                  const creatorLabel = post.creator.name
                    ? `${t(`creator.${post.creator.kind}`)} · ${post.creator.name}`
                    : t(`creator.${post.creator.kind}`);

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
                        <p className="line-clamp-2 text-sm whitespace-pre-wrap">
                          {post.text}
                        </p>
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
                        </div>
                        {post.status === "FAILED" && post.lastError ? (
                          <p className="text-destructive text-xs">
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
                                  {post.status === "SCHEDULED"
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
    </section>
  );
}
