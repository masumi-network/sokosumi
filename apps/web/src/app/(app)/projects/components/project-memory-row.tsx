"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import Markdown from "@/components/markdown";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { getProjectContextMd } from "@/lib/actions/project/action";
import type { ProjectContextMdMetadata } from "@/lib/clients/generated/core/types.gen";
import { cn } from "@/lib/utils";

interface ProjectMemoryRowProps {
  projectId: string;
  contextMd: ProjectContextMdMetadata | null;
  contextMdUpdating: boolean;
}

export function ProjectMemoryRow({
  projectId,
  contextMd,
  contextMdUpdating,
}: ProjectMemoryRowProps) {
  const t = useTranslations("App.Projects.Detail");
  const formatter = useFormatter();
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const updatedLabel = contextMd
    ? t("memory.updated", {
        when: formatter.relativeTime(new Date(contextMd.updatedAt)),
      })
    : null;

  async function handleOpen() {
    if (!contextMd) {
      return;
    }

    setOpen(true);
    setIsLoading(true);
    try {
      const result = await getProjectContextMd({ projectId });
      setContent(result.content);
    } catch (error) {
      console.error("Failed to load project memory", error);
      toast.error(t("errors.contextMd"));
      setOpen(false);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCopyLink() {
    if (!contextMd) {
      return;
    }

    try {
      await navigator.clipboard.writeText(contextMd.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("errors.contextMd"));
    }
  }

  if (!contextMd && !contextMdUpdating) {
    return (
      <p
        className="text-muted-foreground/50 text-xs"
        data-testid="project-memory-empty"
      >
        {t("memory.empty")}
      </p>
    );
  }

  const meta = [
    t("memory.fileName"),
    contextMd && updatedLabel ? updatedLabel : null,
    contextMd
      ? `${contextMd.model.label}${contextMd.model.region === "eu" ? " 🇪🇺" : ""}`
      : null,
    contextMdUpdating ? t("memory.updating") : null,
  ].filter((part): part is string => Boolean(part));

  return (
    <>
      <button
        type="button"
        data-testid="project-memory-row"
        disabled={!contextMd}
        onClick={() => void handleOpen()}
        className={cn(
          "text-muted-foreground/70 flex max-w-full items-center gap-1.5 text-left text-xs",
          contextMd && "hover:text-muted-foreground transition-colors",
          !contextMd && "cursor-default",
        )}
      >
        <span className="truncate">{meta.join(" · ")}</span>
        {contextMdUpdating ? (
          <span
            className="bg-muted-foreground/40 size-1.5 shrink-0 animate-pulse rounded-full"
            data-testid="project-memory-updating"
            aria-hidden
          />
        ) : null}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85dvh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <div className="space-y-1 border-b px-6 py-5">
            <DialogTitle className="text-base font-semibold tracking-tight">
              {t("memory.title")}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-xs">
              {meta.join(" · ")}
            </DialogDescription>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {isLoading ? (
              <p className="text-muted-foreground/60 text-sm">
                {t("memory.updating")}
              </p>
            ) : content ? (
              <Markdown className="text-foreground/80">{content}</Markdown>
            ) : null}
          </div>

          {contextMd ? (
            <div className="flex justify-end gap-2 border-t px-6 py-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleCopyLink()}
              >
                {copied ? t("memory.copied") : t("memory.copyLink")}
              </Button>
              <Button type="button" variant="outline" size="sm" asChild>
                <a
                  href={contextMd.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("memory.openRaw")}
                </a>
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
