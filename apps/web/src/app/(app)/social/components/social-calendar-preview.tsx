"use client";

import type {
  ProjectSocialConnection,
  SocialPost,
} from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { createContext, useContext, useRef, useState } from "react";
import { toast } from "sonner";
import { ProjectSocialPosts } from "@/app/projects/components/social-posts/project-social-posts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { loadSocialCalendarPreview } from "./social-calendar-preview-actions";

const SocialCalendarPreviewContext = createContext<
  ((projectId: string, postId: string, trigger: HTMLElement) => void) | null
>(null);

export function useSocialCalendarPreview() {
  return useContext(SocialCalendarPreviewContext);
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

function previewLoadErrorCopy(
  error: unknown,
  t: (key: string) => string,
): string {
  if (isBrowserOffline()) return t("preview.offline");
  if (isTimeoutRejection(error)) return t("preview.timeout");
  if (error instanceof Error && error.message === "Social post not found") {
    return t("preview.missing");
  }
  return t("toasts.failed");
}

/** Preview a calendar post without changing the workspace's project or URL. */
export function SocialCalendarPreviewProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations("App.Projects.SocialPosts");
  const triggerRef = useRef<HTMLElement | null>(null);
  const request = useRef(0);
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState<{
    post: SocialPost;
    connections: ProjectSocialConnection[];
  } | null>(null);

  async function show(projectId: string, postId: string, trigger: HTMLElement) {
    triggerRef.current = trigger;
    const current = ++request.current;
    setTarget(null);
    setLoading(true);
    try {
      const next = await loadSocialCalendarPreview({ projectId, postId });
      if (current !== request.current) return;
      setTarget(next);
    } catch (error) {
      if (current === request.current) {
        toast.error(previewLoadErrorCopy(error, t));
      }
    } finally {
      if (current === request.current) setLoading(false);
    }
  }

  return (
    <SocialCalendarPreviewContext.Provider
      value={(projectId, postId, trigger) => {
        void show(projectId, postId, trigger);
      }}
    >
      {children}
      <Dialog
        open={loading}
        onOpenChange={(open) => {
          if (!open) {
            ++request.current;
            setLoading(false);
          }
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          aria-busy="true"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!target) triggerRef.current?.focus({ preventScroll: true });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("preview.dialogTitle")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("loading")}
            </DialogDescription>
          </DialogHeader>
          <div
            aria-hidden
            className="space-y-2"
            data-testid="social-calendar-preview-skeleton"
          >
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </DialogContent>
      </Dialog>
      {target ? (
        <ProjectSocialPosts
          key={`${target.post.id}-${request.current}`}
          connections={target.connections}
          posts={[target.post]}
          projectId={target.post.projectId}
          selectedPostId={target.post.id}
          previewOnly
          returnFocus={() => triggerRef.current?.focus({ preventScroll: true })}
        />
      ) : null}
    </SocialCalendarPreviewContext.Provider>
  );
}
