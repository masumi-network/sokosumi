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
import { buildSeoTimeline } from "./seo-timeline-model";

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
  const taskStatus = useTranslations("App.Tasks.Filters.statusOptions");
  const nodes = buildSeoTimeline(workspace);
  return (
    <SeoSection title={t("timeline.title")}>
      {nodes.length === 0 ? (
        <SeoEmpty title={t("timeline.empty")} body={t("timeline.emptyBody")} />
      ) : (
        <>
          <p className="text-muted-foreground px-2 text-xs">
            {t("timeline.graphDescription")}
          </p>
          <div
            className="overflow-x-auto rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
            role="region"
            aria-label={t("timeline.graphLabel")}
            tabIndex={0}
          >
            <ol
              aria-label={t("timeline.graphLabel")}
              className="flex min-w-full w-max items-stretch pb-2"
            >
              {nodes.map(
                ({ event, observation, at, isRecheck, label }, index) => {
                  const status = event.status.toLowerCase();
                  const failed = status === "failed";
                  const Icon = failed ? CircleAlert : icons[event.kind];
                  const hasSaveTime =
                    observation &&
                    new Date(observation.observedAt).getTime() !==
                      new Date(event.at).getTime();
                  return (
                    <li
                      key={event.id}
                      className="relative flex w-72 shrink-0 flex-col px-2 pt-1"
                    >
                      <div
                        aria-hidden
                        className={cn(
                          "bg-border absolute top-5 h-px",
                          index === 0 ? "left-1/2" : "left-0",
                          index === nodes.length - 1 ? "right-1/2" : "right-0",
                        )}
                      />
                      <span className="bg-foreground text-background relative mx-auto mb-3 flex size-8 shrink-0 items-center justify-center rounded-full">
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <div
                        className={cn(
                          HOLDER_ITEM_CLASS,
                          "flex flex-1 flex-col gap-3 p-4",
                        )}
                      >
                        <div className="text-muted-foreground space-y-1 text-xs">
                          {observation ? (
                            <span className="block">
                              {t("timeline.checkedAt")}
                            </span>
                          ) : null}
                          <SeoDate value={at} />
                        </div>
                        <h3 className="text-sm font-medium">
                          {t(`timeline.${label}`)}
                        </h3>
                        <div className="flex flex-wrap items-center gap-2">
                          <SeoState>{t(`timeline.${event.kind}`)}</SeoState>
                          {event.kind === "action" &&
                          taskStatus.has(event.status) ? (
                            <SeoState>{taskStatus(event.status)}</SeoState>
                          ) : t.has(`timeline.statuses.${status}`) ? (
                            <SeoState>
                              {t(`timeline.statuses.${status}`)}
                            </SeoState>
                          ) : null}
                        </div>
                        {event.kind === "action" ? (
                          <p className="text-muted-foreground text-xs">
                            {t("timeline.currentTaskStatus")}
                          </p>
                        ) : null}
                        {observation ? (
                          <div className="text-muted-foreground space-y-2 text-xs">
                            <p>
                              {t("timeline.checkSummary", {
                                checked: observation.coverage.checked,
                              })}
                            </p>
                            {observation.coverage.modules ? (
                              <p>
                                {t("overview.moduleCoverage", {
                                  notRequested:
                                    observation.coverage.modules.notRequested,
                                  failed: observation.coverage.modules.failed,
                                })}
                              </p>
                            ) : null}
                            {observation.coverage.failed > 0 ||
                            (observation.coverage.modules?.failed ?? 0) > 0 ? (
                              <p>{t("timeline.incomplete")}</p>
                            ) : null}
                            <p>
                              {t("pages.count", {
                                count: observation.pageIds.length,
                              })}
                              {observation.countryCode
                                ? ` · ${observation.countryCode} / ${observation.languageCode ?? t("none")}`
                                : ""}
                            </p>
                            {isRecheck ? (
                              <p>{t("timeline.previousCheck")}</p>
                            ) : null}
                          </div>
                        ) : event.kind === "page_change" ? (
                          <p className="text-sm break-words">{event.title}</p>
                        ) : null}
                        <details className="text-muted-foreground text-xs">
                          <summary className="cursor-pointer underline-offset-4 hover:underline">
                            {t("timeline.sourceDetails")}
                          </summary>
                          <div className="space-y-2 pt-2">
                            {hasSaveTime ? (
                              <div>
                                <span>{t("timeline.savedAt")}</span>{" "}
                                <SeoDate value={event.at} />
                              </div>
                            ) : null}
                            <p className="whitespace-pre-wrap break-words">
                              {event.detail}
                            </p>
                            {observation ? (
                              <p>
                                {observation.devices
                                  .map((device) => t(`analysis.${device}`))
                                  .join(", ")}
                                {" · "}
                                {t("scopeVersion", {
                                  version: observation.scopeVersion,
                                })}
                                {" · "}
                                {t("timeline.rulebook", {
                                  version: observation.rulebookVersion,
                                })}
                              </p>
                            ) : null}
                          </div>
                        </details>
                        <div className="mt-auto flex flex-wrap items-center gap-3 pt-1 text-xs">
                          {event.taskId ? (
                            <Link
                              href={`/tasks/${encodeURIComponent(event.taskId)}`}
                              className="underline underline-offset-4"
                            >
                              {t("openTask")}
                            </Link>
                          ) : null}
                          {failed && event.kind === "check" && onRetry ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={onRetry}
                            >
                              {t("timeline.runNewCheck")}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                },
              )}
            </ol>
          </div>
        </>
      )}
    </SeoSection>
  );
}
