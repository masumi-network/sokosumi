"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { CircleAlert, Loader2, Play, Plus, RotateCw } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { StatusBadge } from "@/components/soko-bot/status-badge";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getEnvPublicConfig } from "@/config/env.public";
import { cn } from "@/lib/utils";
import { SeoGoogleConnection } from "./seo-google-connection";
import { SeoSetupGoal } from "./seo-setup-goal";
import {
  type SeoSetup,
  type SeoSetupState,
  seoRunAction,
  seoRunningCheck,
  seoRunProgress,
} from "./seo-setup-model";
import { SEO_GHOST_EDGE_CLASS } from "./seo-shared";
import { SeoStep, SeoStepList, type SeoStepMark } from "./seo-steps";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

const TITLE_ID = "seo-setup-title";
const PAUSED_REASON_ID = "seo-setup-paused-reason";
const MINUTE_MS = 60_000;
const MARK: Record<SeoSetupState, SeoStepMark> = {
  done: "done",
  next: "active",
  running: "busy",
  waiting: "todo",
};

/**
 * A check in flight: its badge, when it started, and how far it is. Core reports no progress and no end time
 * for a check, so the share and the time left are an estimate from earlier runs, and the words say so.
 */
export function SeoCheckRunning({
  workspace,
}: {
  workspace: ProjectSeoWorkspace;
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const now = useNow({ updateInterval: MINUTE_MS });
  const check = seoRunningCheck(workspace);
  const progress = seoRunProgress(workspace, now);
  if (!check || !progress) return null;
  const started = new Date(check.createdAt);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {/* The agent panel announces a running check; this badge is its picture. */}
      <span aria-hidden>
        <StatusBadge tone="working" live>
          {t("setup.checkRunningBadge")}
        </StatusBadge>
      </span>
      <span className="text-muted-foreground text-sm">
        {/* Under a minute, and with a clock that runs behind Core's, the words say "just now". */}
        {now.getTime() - started.getTime() < MINUTE_MS
          ? t("setup.checkStartedNow")
          : t("setup.checkStarted", {
              when: format.relativeTime(started, now),
            })}
        {progress.minutesLeft
          ? ` ${t("setup.checkLeft", { minutes: progress.minutesLeft })}`
          : progress.late
            ? ` ${t("setup.checkLate")}`
            : null}
      </span>
      {progress.share === null ? null : (
        // A line of its own under the words, as wide as a short sentence.
        <Progress
          aria-label={t("setup.checkProgress")}
          value={Math.round(progress.share * 100)}
          className="h-1 max-w-64 basis-full"
        />
      )}
    </div>
  );
}

/** First run of an Audit: add a page, then run the first check. One step has the primary button. */
export function SeoSetupCard({
  model,
  setup,
}: {
  model: SeoWorkspaceModel;
  setup: SeoSetup;
}) {
  const t = useTranslations("App.Seo");
  const pages = model.data.scope.pageIds.length;
  // The widest check this workspace can run on these pages: the first result is the full one where it can be.
  const run = seoRunAction(model.data);
  const full = run?.kind === "audit_full";
  const pausedReason =
    setup.check === "next" && !model.data.availableActions.canRequestAnalysis
      ? t(
          getEnvPublicConfig().NEXT_PUBLIC_VERCEL_ENV === "preview"
            ? "setup.pausedPreviewReason"
            : "setup.pausedReason",
        )
      : null;
  const goalPage = model.data.pages.find(
    (page) => page.id === model.setupGoalPageId,
  );
  return (
    <section
      aria-labelledby={TITLE_ID}
      // The same inset as the rows under it, so both columns of marks line up.
      className={cn(HOLDER_ITEM_CLASS, "content-rise space-y-6 p-4")}
      data-testid="seo-setup"
    >
      <h3 id={TITLE_ID} className="text-lg font-semibold">
        {t("setup.title")}
      </h3>
      <SeoStepList label={t("setup.steps")}>
        <SeoStep
          index={1}
          heading="h4"
          mark={MARK[setup.page]}
          doneLabel={t("setup.done")}
          title={t(setup.page === "done" ? "setup.pageDone" : "setup.page")}
          body={
            setup.page === "done"
              ? t("setup.pageDoneBody", { count: pages })
              : t("setup.pageBody")
          }
        >
          <Button
            size="sm"
            variant={setup.page === "done" ? "ghost" : "primary"}
            className={setup.page === "done" ? SEO_GHOST_EDGE_CLASS : undefined}
            onClick={() => model.setDialog("page")}
          >
            <Plus />
            {t("addPage")}
          </Button>
        </SeoStep>
        {setup.page === "done" ? (
          <SeoStep
            index={2}
            heading="h4"
            mark={MARK[setup.connection]}
            doneLabel={t("setup.done")}
            title={t(
              setup.connection === "done"
                ? "statistics.title"
                : "audits.onboarding.connectTitle",
            )}
            body={
              setup.connection === "next" ? t("setup.googleBody") : undefined
            }
          >
            {setup.connection === "waiting" ? null : (
              <div className="space-y-2">
                <SeoGoogleConnection
                  variant={setup.connection === "next" ? "primary" : "outline"}
                  onSettings={() => model.openStatistics("search_console")}
                />
                {setup.connection === "next" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={model.skipGoogleSetup}
                  >
                    {t("setup.skipGoogle")}
                  </Button>
                ) : null}
              </div>
            )}
          </SeoStep>
        ) : null}
        {setup.check !== "waiting" ? (
          <SeoStep
            index={3}
            heading="h4"
            last
            mark={MARK[setup.check]}
            title={t(full ? "setup.audit" : "setup.check")}
            body={
              pausedReason ? (
                <span id={PAUSED_REASON_ID} role="status">
                  {pausedReason}
                </span>
              ) : setup.failed ? (
                // The failure sits on the step whose button runs the check again.
                <span className="text-destructive flex items-start gap-1.5">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" />
                  {t("setup.checkFailed")}
                </span>
              ) : (
                // A step that waits is a title only: the step before it has the action.
                // Waiting steps are now hidden until the preceding step completes.
                t(
                  setup.check === "running"
                    ? "setup.checkRunning"
                    : full
                      ? "setup.auditBody"
                      : "setup.checkBody",
                )
              )
            }
          >
            {goalPage ? (
              <SeoSetupGoal
                key={`${model.setupScopeKey}:${run?.kind ?? "paused"}`}
                model={model}
                page={goalPage}
                full={full}
              />
            ) : !run ? null : (
              <div className="flex flex-wrap items-center gap-2">
                {/* The button stays while its check runs, so keyboard focus stays too. */}
                <Button
                  size="sm"
                  variant={setup.check === "next" ? "primary" : "outline"}
                  // Not the disabled attribute: that drops focus from the button.
                  aria-disabled={setup.check === "running" || undefined}
                  className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                  onClick={() => {
                    if (setup.check !== "running" && run)
                      model.openAnalysis(run.kind);
                  }}
                >
                  {setup.check === "running" ? (
                    <Loader2 className="animate-spin motion-reduce:animate-pulse" />
                  ) : setup.failed ? (
                    <RotateCw />
                  ) : (
                    <Play />
                  )}
                  {t(
                    setup.check === "running"
                      ? "setup.checkRunningBadge"
                      : full
                        ? "runFullAudit"
                        : "runPageCheck",
                  )}
                </Button>
                <SeoCheckRunning workspace={model.data} />
              </div>
            )}
            {pausedReason ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-disabled="true"
                    aria-describedby={PAUSED_REASON_ID}
                    className="bg-muted text-muted-foreground hover:bg-muted hover:text-muted-foreground mt-2 cursor-not-allowed"
                  >
                    <Play />
                    {t("setup.pausedStart")}
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  {pausedReason}
                </TooltipContent>
              </Tooltip>
            ) : null}
          </SeoStep>
        ) : null}
      </SeoStepList>
    </section>
  );
}
