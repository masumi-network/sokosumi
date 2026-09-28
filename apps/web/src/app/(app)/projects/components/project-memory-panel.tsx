"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import Markdown from "@/components/markdown";
import { Button } from "@/components/ui/button";
import type {
  ProjectContextMdMetadata,
  ProjectMemoryModel,
} from "@/lib/clients/generated/core/types.gen";

import {
  ProjectMemoryHistory,
  type ProjectMemoryVersion,
} from "./project-memory-history";

interface ProjectMemoryPanelProps {
  contextMd: ProjectContextMdMetadata | null;
  contextMdUpdating: boolean;
  /** The current version's Markdown, or null when there is none to read. */
  content: string | null;
  memoryEnabled?: boolean;
  memoryModel?: ProjectMemoryModel | null;
}

function resolveMemoryModel(
  contextMd: ProjectContextMdMetadata | null,
  memoryModel?: ProjectMemoryModel | null,
): ProjectMemoryModel | null {
  return memoryModel ?? contextMd?.model ?? null;
}

/**
 * The Memory tab: what the project knows about itself.
 *
 * The same four facts the sidebar row used to show — when it last changed,
 * which model writes it, whether updates are switched on at all, and whether
 * one is running right now — except the document is on the page instead of
 * behind a dialog, because a tab is already the "show me this" gesture and a
 * dialog on top of it would be one click to reach the same words.
 */
export function ProjectMemoryPanel({
  content,
  contextMd,
  contextMdUpdating,
  memoryEnabled = true,
  memoryModel,
}: ProjectMemoryPanelProps) {
  const t = useTranslations("App.Projects.Detail");
  const formatter = useFormatter();
  const [copied, setCopied] = useState(false);
  const model = resolveMemoryModel(contextMd, memoryModel);
  const modelLabel = model?.label ?? t("memory.defaultModel");

  async function handleCopyLink() {
    if (!contextMd) return;
    try {
      await navigator.clipboard.writeText(contextMd.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("errors.contextMd"));
    }
  }

  // Only the current version exists to list. See `ProjectMemoryHistory`.
  const versions: ProjectMemoryVersion[] = contextMd
    ? [
        {
          version: contextMd.version,
          updatedAt: contextMd.updatedAt,
          modelLabel,
          content,
        },
      ]
    : [];

  return (
    <div className="max-w-3xl min-w-0 space-y-8">
      <section className="space-y-3" data-testid="project-memory-panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-muted-foreground text-xs font-medium">
              {t("memory.fileName")}
            </h2>
            <div className="mt-1 flex items-center gap-1.5">
              <p className="truncate text-sm font-medium">
                {contextMd
                  ? t("memory.updated", {
                      when: formatter.relativeTime(
                        new Date(contextMd.updatedAt),
                      ),
                    })
                  : t("memory.empty")}
              </p>
              {contextMdUpdating ? (
                <span
                  aria-label={t("memory.updating")}
                  className="bg-tertiary size-1.5 shrink-0 animate-pulse rounded-full"
                  data-testid="project-memory-updating"
                  role="status"
                />
              ) : null}
            </div>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {t("memory.modelLine", { model: modelLabel })}
            </p>
            {/* Existing memory stays readable when updates are switched off —
                the hint only explains why it will not grow. */}
            {memoryEnabled === false ? (
              <p
                className="text-muted-foreground mt-0.5 text-xs"
                data-testid="project-memory-disabled"
              >
                {t("memory.notConfigured")}
              </p>
            ) : null}
          </div>

          {contextMd ? (
            <div className="flex shrink-0 gap-2">
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
        </div>

        {content ? (
          <Markdown className="text-foreground">{content}</Markdown>
        ) : (
          <p className="text-muted-foreground motion-safe:animate-in motion-safe:fade-in-0 text-sm text-pretty duration-200">
            {contextMd ? t("errors.contextMd") : t("memory.emptyBody")}
          </p>
        )}
      </section>

      {/* Nothing has been written yet means there is nothing to have a history
          of, and a "History (0)" row there reads as something broken rather
          than as something not started. */}
      {contextMd ? <ProjectMemoryHistory versions={versions} /> : null}
    </div>
  );
}
