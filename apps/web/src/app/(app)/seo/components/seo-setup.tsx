"use client";

import { BarChart3, CircleAlert, Play, Plus, RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { StatusBadge } from "@/components/soko-bot/status-badge";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { SeoConnectionButton } from "./seo-connection-button";
import { SeoGoogleConnection } from "./seo-google-connection";
import type { SeoSetup, SeoSetupState } from "./seo-setup-model";
import { SeoStep, SeoStepList, type SeoStepMark } from "./seo-steps";
import { useSearchConsoleConnected } from "./use-seo-connection";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

const TITLE_ID = "seo-setup-title";
const PERCENT = 100;
const STEP_TITLE = {
  page: "setup.page",
  connect: "setup.connect",
  check: "setup.check",
} as const;
const MARK: Record<SeoSetupState, SeoStepMark> = {
  done: "done",
  next: "active",
  running: "busy",
  open: "todo",
  waiting: "todo",
  unavailable: "todo",
};

/** First run of an Audit: three steps, and one primary button on the next one. */
export function SeoSetupCard({
  model,
  setup,
}: {
  model: SeoWorkspaceModel;
  setup: SeoSetup;
}) {
  const t = useTranslations("App.Seo");
  const [page, connect, check] = setup.steps;
  const pages = model.data.scope.pageIds.length;
  // A connected account with no saved statistics: the step asks for the sync, not for the account.
  // Read only while the step offers the connection: its button reads the same key.
  const offered = connect.state === "next" || connect.state === "open";
  const sync = useSearchConsoleConnected(offered) && offered;
  const connectTitle = t(
    connect.state === "done"
      ? "setup.connectDone"
      : sync
        ? "syncStatistics"
        : STEP_TITLE.connect,
  );
  const progress = t("setup.progress", {
    done: setup.done,
    total: setup.total,
  });
  const variant = (state: SeoSetupState) =>
    state === "next" ? "primary" : "outline";
  return (
    <section
      aria-labelledby={TITLE_ID}
      // The same inset as the rows under it, so both columns of marks line up.
      className={cn(HOLDER_ITEM_CLASS, "content-rise space-y-6 p-4")}
      data-testid="seo-setup"
    >
      <header className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 id={TITLE_ID} className="text-lg font-semibold">
            {t("setup.title")}
          </h3>
          {/* The bar carries this text as its value, so it is not read twice. */}
          <p aria-hidden className="text-muted-foreground text-sm tabular-nums">
            {progress}
          </p>
        </div>
        {/* Neutral fill: the brand colour marks only the next step and its button. */}
        <Progress
          value={(setup.done / setup.total) * PERCENT}
          className="h-1.5"
          indicatorClassName="bg-foreground"
          aria-labelledby={TITLE_ID}
          getValueLabel={() => progress}
        />
        {setup.next ? (
          <p className="text-sm">
            {t("setup.next", {
              step:
                setup.next === "connect"
                  ? connectTitle
                  : t(STEP_TITLE[setup.next]),
            })}
          </p>
        ) : null}
      </header>
      <SeoStepList label={t("setup.steps")}>
        <SeoStep
          index={1}
          heading="h4"
          mark={MARK[page.state]}
          doneLabel={t("setup.done")}
          title={t(page.state === "done" ? "setup.pageDone" : "setup.page")}
          body={
            page.state === "done"
              ? t("setup.pageDoneBody", { count: pages })
              : t("setup.pageBody")
          }
        >
          <Button
            size="sm"
            variant={page.state === "done" ? "ghost" : variant(page.state)}
            onClick={() => model.setDialog("page")}
          >
            <Plus />
            {t("addPage")}
          </Button>
        </SeoStep>
        <SeoStep
          index={2}
          heading="h4"
          mark={MARK[connect.state]}
          doneLabel={t("setup.done")}
          title={connectTitle}
          body={t(
            connect.state === "done"
              ? "setup.connectDoneBody"
              : connect.state === "unavailable"
                ? "setup.connectUnavailable"
                : connect.state === "waiting"
                  ? "setup.waiting"
                  : sync
                    ? "setup.syncBody"
                    : "setup.connectBody",
          )}
        >
          {connect.state === "unavailable" ||
          connect.state === "waiting" ? null : (
            <div className="flex flex-wrap items-start gap-2">
              {connect.state === "done" ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void model.setFilters({ tab: "traffic" });
                    }}
                  >
                    <BarChart3 />
                    {t("agent.openTraffic")}
                  </Button>
                  <SeoConnectionButton
                    provider="ga4"
                    onConnected={() => model.openStatistics("ga4")}
                    onSync={() => model.openStatistics("ga4")}
                  />
                </>
              ) : (
                <SeoGoogleConnection
                  variant={variant(connect.state)}
                  onConnected={model.openStatistics}
                  onSync={model.openStatistics}
                />
              )}
            </div>
          )}
        </SeoStep>
        <SeoStep
          index={3}
          heading="h4"
          last
          mark={MARK[check.state]}
          title={t("setup.check")}
          body={
            setup.failed ? (
              // The failure sits on the step whose button runs the check again.
              <span className="text-destructive flex items-start gap-1.5">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                {t("setup.checkFailed")}
              </span>
            ) : (
              t(
                check.state === "running"
                  ? "setup.checkRunning"
                  : check.state === "waiting"
                    ? "setup.waiting"
                    : check.state === "unavailable"
                      ? "setup.checkUnavailable"
                      : "setup.checkBody",
              )
            )
          }
        >
          {check.state === "running" ||
          check.state === "next" ||
          check.state === "open" ? (
            <div className="flex flex-wrap items-center gap-2">
              {/* The button stays while its check runs, so keyboard focus stays too. */}
              <Button
                size="sm"
                variant={variant(check.state)}
                // Not the disabled attribute: that drops focus from the button.
                aria-disabled={check.state === "running" || undefined}
                className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                onClick={() => {
                  if (check.state !== "running") model.setDialog("analysis");
                }}
              >
                {setup.failed ? <RotateCw /> : <Play />}
                {t("runAnalysis")}
              </Button>
              {check.state === "running" ? (
                // The agent panel announces a running check; this badge is its picture.
                <span aria-hidden>
                  <StatusBadge tone="working" live>
                    {t("setup.checkRunningBadge")}
                  </StatusBadge>
                </span>
              ) : null}
            </div>
          ) : null}
        </SeoStep>
      </SeoStepList>
    </section>
  );
}
