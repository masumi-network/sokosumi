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
import type {
  ProjectContextMdMetadata,
  ProjectMemoryModel,
} from "@/lib/clients/generated/core/types.gen";

interface ProjectMemoryRowProps {
  projectId: string;
  contextMd: ProjectContextMdMetadata | null;
  contextMdUpdating: boolean;
  memoryEnabled?: boolean;
  memoryModel?: ProjectMemoryModel | null;
}

function resolveMemoryModel(
  contextMd: ProjectContextMdMetadata | null,
  memoryModel?: ProjectMemoryModel | null,
): ProjectMemoryModel | null {
  return memoryModel ?? contextMd?.model ?? null;
}

export function ProjectMemoryRow({
  projectId,
  contextMd,
  contextMdUpdating,
  memoryEnabled = true,
  memoryModel,
}: ProjectMemoryRowProps) {
  const t = useTranslations("App.Projects.Detail");
  const formatter = useFormatter();
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const model = resolveMemoryModel(contextMd, memoryModel);
  const modelLabel = model?.label ?? t("memory.defaultModel");

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

  // Existing memory stays visible even when updates are switched off — the
  // hint only explains why it will not grow.
  const notConfiguredHint =
    memoryEnabled === false ? (
      <p
        className="text-muted-foreground/60 truncate text-xs"
        data-testid="project-memory-disabled"
      >
        {t("memory.notConfigured")}
      </p>
    ) : null;

  if (!contextMd && !contextMdUpdating) {
    return (
      <section
        className="min-w-0 self-start space-y-2"
        data-testid="project-memory-empty"
      >
        <h2 className="text-muted-foreground/60 text-xs font-medium">
          {t("memory.fileName")}
        </h2>
        <p className="truncate text-sm font-medium">{t("memory.empty")}</p>
        <div className="space-y-0.5">
          <p className="text-muted-foreground truncate text-xs">
            {t("memory.modelLine", { model: modelLabel })}
          </p>
          {notConfiguredHint}
        </div>
      </section>
    );
  }

  const statusLabel = contextMd
    ? t("memory.updated", {
        when: formatter.relativeTime(new Date(contextMd.updatedAt)),
      })
    : t("memory.empty");
  const summary = `${statusLabel} · ${t("memory.modelLine", {
    model: modelLabel,
  })}`;

  return (
    <>
      <button
        type="button"
        data-testid="project-memory-row"
        disabled={!contextMd}
        onClick={() => void handleOpen()}
        className="hover:bg-card-background -mx-2 min-w-0 w-[calc(100%+1rem)] space-y-2 self-start rounded-lg px-2 py-2 text-left transition-colors disabled:cursor-default disabled:hover:bg-transparent"
      >
        <h2 className="text-muted-foreground/60 text-xs font-medium">
          {t("memory.fileName")}
        </h2>
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium">{statusLabel}</p>
          {contextMdUpdating ? (
            <span
              className="bg-tertiary size-1.5 shrink-0 animate-pulse rounded-full"
              data-testid="project-memory-updating"
              aria-hidden
            />
          ) : null}
        </div>
        <div className="space-y-0.5">
          <p className="text-muted-foreground truncate text-xs">
            {t("memory.modelLine", { model: modelLabel })}
          </p>
          {notConfiguredHint}
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85dvh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <div className="space-y-1 border-b px-6 py-5">
            <DialogTitle className="text-base font-semibold tracking-tight">
              {t("memory.title")}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-xs">
              {summary}
            </DialogDescription>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {isLoading ? (
              <p className="text-muted-foreground/60 text-sm">
                {t("memory.loading")}
              </p>
            ) : content ? (
              <Markdown className="text-foreground">{content}</Markdown>
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
