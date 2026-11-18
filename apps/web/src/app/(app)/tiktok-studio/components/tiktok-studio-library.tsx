"use client";

import type { ProjectImageJob } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";

import { assetContentUrl } from "@/app/projects/components/image-studio/types";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

import { ACTIVE_STATUSES, type TalkingVideoAsset } from "./tiktok-studio-stage";

/** Every video of the project, small; choosing one shows it on the stage. */
export function TikTokStudioLibrary({
  jobs,
  assetFor,
  selectedId,
  onSelect,
}: {
  jobs: ProjectImageJob[];
  assetFor: (job: ProjectImageJob) => TalkingVideoAsset | null;
  selectedId: string | null;
  onSelect: (job: ProjectImageJob) => void;
}) {
  const t = useTranslations("App.TikTokStudio");
  return (
    <section aria-label={t("videos")} className={cn(HOLDER_CLASS, "min-w-0")}>
      <h2 className="text-muted-foreground px-2 pt-1 pb-2 text-xs font-medium">
        {t("videos")}
      </h2>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
        {jobs.map((job) => {
          const asset = assetFor(job);
          const selected = job.id === selectedId;
          return (
            <li className="min-w-0" key={job.id}>
              <button
                aria-pressed={selected}
                className="group press flex w-full min-w-0 flex-col gap-1 rounded-lg text-start"
                onClick={() => onSelect(job)}
                type="button"
              >
                <span
                  className={cn(
                    "bg-background relative flex aspect-9/16 w-full items-center justify-center overflow-hidden rounded-lg border-2 p-2 text-center text-xs",
                    selected ? "border-foreground" : "border-transparent",
                  )}
                >
                  {asset ? (
                    <video
                      aria-hidden
                      className="pointer-events-none absolute inset-0 size-full object-cover"
                      muted
                      playsInline
                      preload="metadata"
                      src={assetContentUrl(asset)}
                      tabIndex={-1}
                    />
                  ) : ACTIVE_STATUSES.has(job.status) ? (
                    t("videoMaking")
                  ) : (
                    <span className="text-muted-foreground">
                      {t("videoFailed")}
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground group-hover:text-foreground line-clamp-2 text-xs transition-colors">
                  {job.prompt}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
