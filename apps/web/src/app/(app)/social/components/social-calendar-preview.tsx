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
import { loadSocialCalendarPreview } from "./social-calendar-preview-actions";

const SocialCalendarPreviewContext = createContext<
  ((projectId: string, postId: string) => void) | null
>(null);

export function useSocialCalendarPreview() {
  return useContext(SocialCalendarPreviewContext);
}

/** Preview a calendar post without changing the workspace's project or URL. */
export function SocialCalendarPreviewProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations("App.Projects.SocialPosts");
  const request = useRef(0);
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState<{
    post: SocialPost;
    connections: ProjectSocialConnection[];
  } | null>(null);

  async function show(projectId: string, postId: string) {
    const current = ++request.current;
    setTarget(null);
    setLoading(true);
    try {
      const next = await loadSocialCalendarPreview({ projectId, postId });
      if (current !== request.current) return;
      setTarget(next);
    } catch {
      if (current === request.current) toast.error(t("toasts.failed"));
    } finally {
      if (current === request.current) setLoading(false);
    }
  }

  return (
    <SocialCalendarPreviewContext.Provider
      value={(projectId, postId) => {
        void show(projectId, postId);
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
        <DialogContent className="sm:max-w-md" aria-busy="true">
          <DialogHeader>
            <DialogTitle>{t("preview.dialogTitle")}</DialogTitle>
            <DialogDescription>{t("loading")}</DialogDescription>
          </DialogHeader>
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
        />
      ) : null}
    </SocialCalendarPreviewContext.Provider>
  );
}
