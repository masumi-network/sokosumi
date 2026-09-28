"use client";

import { ChevronRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import Markdown from "@/components/markdown";
import { cn } from "@/lib/utils";

export interface ProjectMemoryVersion {
  /** `contextMdVersion` at the time this content was written. */
  version: number;
  updatedAt: Date | string;
  modelLabel: string;
  /** Null when a version is known to exist but its content is not held. */
  content: string | null;
}

/**
 * Every version of a project's memory this product can still produce, newest
 * first, collapsed until asked for.
 *
 * Today that is one entry, the current version, and the note under the list
 * says so. Nothing retains the earlier ones: `contextMd` is a single column
 * that each refresh overwrites, the blob is written to one fixed path with
 * `allowOverwrite`, and `contextMdVersion` is a counter rather than a key into
 * anything. This component takes a list precisely so that the day a revision
 * table exists it grows a longer one and nothing here changes.
 */
export function ProjectMemoryHistory({
  versions,
}: {
  versions: readonly ProjectMemoryVersion[];
}) {
  const t = useTranslations("App.Projects.Detail.memory");
  const [open, setOpen] = useState(false);

  return (
    <section className="space-y-3" data-testid="project-memory-history">
      <button
        type="button"
        aria-controls="project-memory-history-list"
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring-halo -mx-1 flex items-center gap-1.5 rounded px-1 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px]"
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronRight
          aria-hidden
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
        />
        {t("history.title", { count: versions.length })}
      </button>

      {open ? (
        <div className="space-y-2" id="project-memory-history-list">
          {versions.length > 0 ? (
            <ul className="divide-border border-border divide-y rounded-lg border">
              {versions.map((version) => (
                <HistoryEntry key={version.version} version={version} />
              ))}
            </ul>
          ) : null}
          {/* Said in the product, not only in a pull request: a history with
              one entry in it should explain why rather than look broken. */}
          <p className="text-muted-foreground text-xs">
            {t("history.onlyCurrentRetained")}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function HistoryEntry({ version }: { version: ProjectMemoryVersion }) {
  const t = useTranslations("App.Projects.Detail.memory");
  const formatter = useFormatter();
  const [open, setOpen] = useState(false);
  const contentId = `project-memory-version-${version.version}`;

  return (
    <li>
      <button
        type="button"
        aria-controls={contentId}
        aria-expanded={open}
        className="hover:bg-card-background focus-visible:ring-ring-halo flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-[3px]"
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "text-muted-foreground size-3.5 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {t("history.version", { version: version.version })}
        </span>
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {formatter.dateTime(new Date(version.updatedAt), "dateTime")}
        </span>
      </button>

      {open ? (
        <div className="space-y-3 px-3 pb-4" id={contentId}>
          <p className="text-muted-foreground text-xs">
            {t("modelLine", { model: version.modelLabel })}
          </p>
          {version.content ? (
            <Markdown className="text-foreground">{version.content}</Markdown>
          ) : (
            <p className="text-muted-foreground text-sm">
              {t("history.contentUnavailable")}
            </p>
          )}
        </div>
      ) : null}
    </li>
  );
}
