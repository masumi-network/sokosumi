"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { CircleAlert, Play, Plus, RotateCw } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { StatusBadge } from "@/components/soko-bot/status-badge";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
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
        <SeoStep
          index={2}
          heading="h4"
          last
          mark={MARK[setup.check]}
          title={t(full ? "setup.audit" : "setup.check")}
          body={
            setup.failed ? (
              // The failure sits on the step whose button runs the check again.
              <span className="text-destructive flex items-start gap-1.5">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                {t("setup.checkFailed")}
              </span>
            ) : // A step that waits is a title only: the step before it has the action.
            setup.check === "waiting" ? undefined : (
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
          {setup.check === "waiting" ? null : (
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
                {setup.failed ? <RotateCw /> : <Play />}
                {t(full ? "runFullAudit" : "runPageCheck")}
              </Button>
              <SeoCheckRunning workspace={model.data} />
            </div>
          )}
        </SeoStep>
      </SeoStepList>
    </section>
  );
}
