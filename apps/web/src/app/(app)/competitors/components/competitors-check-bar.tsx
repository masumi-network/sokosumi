"use client";

import type { ProjectCompetitors } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { RoutePoller } from "@/components/route-poller";
import { Button } from "@/components/ui/button";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import {
  runCompetitorCheck,
  setCompetitorChecks,
} from "@/lib/actions/competitors/action";
import { cn } from "@/lib/utils";

type Check = ProjectCompetitors["check"];
type Pending = "switch" | "run" | null;

const SOURCES = ["pages", "news", "ads", "social"] as const;
/** How often the page asks whether the first check has finished. */
const FIRST_CHECK_POLL_MS = 4_000;
/** Three minutes: a check that was not paid for never finishes. */
const FIRST_CHECK_POLLS = 45;

/**
 * The weekly check in one line: how it stands, what it costs, and the
 * switch. Off, turning it on is the page's main action. A CMO Project's
 * check is run by CMO, so here it only says how it stands.
 */
export function CompetitorsCheckBar({
  check,
  competitorCount,
  projectId,
  readOnly,
}: {
  check: Check;
  competitorCount: number;
  projectId: string;
  readOnly: boolean;
}) {
  const t = useTranslations("App.Competitors.check");
  const format = useFormatter();
  const [pending, setPending] = useState<Pending>(null);
  const [, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const running = check.on && !check.lastCheckedAt && competitorCount > 0;
  const day = (date: Date) =>
    format.dateTime(date, { day: "numeric", month: "short" });
  const weekly = check.creditsPerCompetitor * competitorCount;
  const failed = SOURCES.filter(
    (source) => check.sources[source].status === "failed",
  );

  function act(
    kind: Exclude<Pending, null>,
    run: () => Promise<string | null>,
  ) {
    setPending(kind);
    setMessage(null);
    startTransition(async () => {
      setMessage(await run());
      setPending(null);
    });
  }

  const turn = (on: boolean) =>
    act("switch", async () => {
      const result = await setCompetitorChecks({ projectId, on });
      return result.ok ? null : (result.error.message ?? t("failed"));
    });

  const runNow = () =>
    act("run", async () => {
      const result = await runCompetitorCheck({ projectId });
      if (!result.ok) return result.error.message ?? t("failed");
      return result.value === "checked"
        ? null
        : t(`outcome.${result.value}`, { credits: weekly });
    });

  const status = !check.on ? "off" : running ? "running" : "on";

  return (
    <section
      aria-labelledby="competitors-check"
      className={cn(
        HOLDER_CLASS,
        "flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="text-sm font-medium" id="competitors-check">
          {t(`status.${status}`)}
        </h2>
        <p className="text-muted-foreground text-sm">
          {status === "on" && check.lastCheckedAt
            ? `${t("last", {
                last: day(check.lastCheckedAt),
                next: check.nextCheckAt ? day(check.nextCheckAt) : "",
              })} `
            : null}
          {status === "running" ? `${t("running")} ` : null}
          {t("price", {
            count: competitorCount,
            credits: weekly,
            each: check.creditsPerCompetitor,
          })}
        </p>
        {failed.length > 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("sourceFailed", {
              sources: failed.map((source) => t(`source.${source}`)).join(", "),
            })}
          </p>
        ) : null}
        {message ? (
          <p className="text-sm" role="alert">
            {message}
          </p>
        ) : null}
      </div>
      {/* Core runs the first check after it answers "on", outside any action:
          nothing tells the page when it is done, so it asks until it is. */}
      {running ? (
        <RoutePoller everyMs={FIRST_CHECK_POLL_MS} times={FIRST_CHECK_POLLS} />
      ) : null}
      {readOnly ? null : (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {status === "running" ? (
            <Button
              disabled={pending !== null}
              loading={pending === "run"}
              onClick={runNow}
              size="sm"
            >
              {t("runNow")}
            </Button>
          ) : null}
          {check.on ? (
            <Button
              disabled={pending !== null}
              loading={pending === "switch"}
              onClick={() => turn(false)}
              size="sm"
            >
              {t("turnOff")}
            </Button>
          ) : (
            <Button
              disabled={pending !== null}
              loading={pending === "switch"}
              onClick={() => turn(true)}
              size="sm"
              variant="primary"
            >
              {t("turnOn")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
