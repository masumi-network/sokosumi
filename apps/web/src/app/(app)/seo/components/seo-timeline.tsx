"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import {
  Activity,
  BarChart3,
  CheckCheck,
  CircleAlert,
  FolderOpen,
  PencilLine,
  SearchCheck,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { SeoDate, SeoEmpty, SeoSection, SeoState } from "./seo-shared";

const icons = {
  audit: SearchCheck,
  check: CheckCheck,
  metrics: BarChart3,
  action: Activity,
  scope: FolderOpen,
  page_change: PencilLine,
};

export function SeoTimeline({
  workspace,
  onRetry,
}: {
  workspace: ProjectSeoWorkspace;
  onRetry?: () => void;
}) {
  const t = useTranslations("App.Seo");
  const items = workspace.timeline;
  return (
    <SeoSection title={t("timeline.title")}>
      {items.length === 0 ? (
        <SeoEmpty title={t("timeline.empty")} body={t("timeline.emptyBody")} />
      ) : (
        <ol className="space-y-2">
          {items.map((item) => {
            const status = item.status.toLowerCase();
            const failed = status === "failed";
            const Icon = failed ? CircleAlert : icons[item.kind];
            const observation = workspace.observations.find(
              (row) => row.id === item.observationId,
            );
            return (
              <li
                key={item.id}
                className={cn(
                  HOLDER_ITEM_CLASS,
                  "flex min-w-0 gap-3 px-4 py-3",
                )}
              >
                <span className="bg-quinary mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg">
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm">{item.title}</span>
                    <SeoState>{t(`timeline.${item.kind}`)}</SeoState>
                    {t.has(`timeline.statuses.${status}`) ? (
                      <SeoState>{t(`timeline.statuses.${status}`)}</SeoState>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground text-sm whitespace-pre-wrap break-words">
                    {item.detail}
                  </p>
                  {observation &&
                  (item.kind === "audit" || item.kind === "check") ? (
                    <div className="text-muted-foreground flex flex-wrap gap-2 text-xs">
                      <span>
                        {t("pages.count", {
                          count: observation.pageIds.length,
                        })}
                      </span>
                      {observation.countryCode ? (
                        <span>
                          {observation.countryCode} /{" "}
                          {observation.languageCode ?? t("none")}
                        </span>
                      ) : null}
                      {observation.devices.map((device) => (
                        <span key={device}>{t(`analysis.${device}`)}</span>
                      ))}
                      {observation.scopeVersion > 0 ? (
                        <span>
                          {t("scopeVersion", {
                            version: observation.scopeVersion,
                          })}
                        </span>
                      ) : null}
                      <span>
                        {t("timeline.rulebook", {
                          version: observation.rulebookVersion,
                        })}
                      </span>
                    </div>
                  ) : null}
                  <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
                    <SeoDate value={item.at} />
                    {item.taskId ? (
                      <Link
                        href={`/tasks/${encodeURIComponent(item.taskId)}`}
                        className="underline underline-offset-4"
                      >
                        {t("openTask")}
                      </Link>
                    ) : null}
                    {failed && item.kind === "check" && onRetry ? (
                      <Button variant="outline" size="sm" onClick={onRetry}>
                        {t("timeline.runNewCheck")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </SeoSection>
  );
}
