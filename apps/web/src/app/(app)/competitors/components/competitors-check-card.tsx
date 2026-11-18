"use client";

import type { ProjectCompetitors } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  runCompetitorCheck,
  setCompetitorChecks,
} from "@/lib/actions/competitors/action";

import { CompetitorsItem, CompetitorsPanel } from "./competitors-panel";

type Check = ProjectCompetitors["check"];
type Pending = "switch" | "run" | null;

const SOURCES = ["pages", "news", "ads", "social"] as const;

/**
 * The weekly check: what it reads, what it costs, and the switch. The price
 * stands beside the button that turns it on. A CMO Project's check is run
 * by CMO, so here it only says how it stands.
 */
export function CompetitorsCheckCard({
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

  const day = (date: Date) =>
    format.dateTime(date, { day: "numeric", month: "short" });
  const weekly = check.creditsPerCompetitor * competitorCount;
  const needs = SOURCES.flatMap((source) => check.sources[source].needs ?? []);
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

  return (
    <CompetitorsPanel
      aside={check.on ? t("on") : t("off")}
      id="competitors-check"
      title={t("title")}
    >
      <CompetitorsItem className="flex flex-col gap-3">
        <p className="text-sm">{t("what")}</p>
        <p className="text-sm">
          {t("price", { credits: check.creditsPerCompetitor })}{" "}
          {competitorCount > 0
            ? t("priceTotal", { count: competitorCount, credits: weekly })
            : null}{" "}
          {readOnly ? null : t("payer")}
        </p>
        {check.on ? (
          <p className="text-muted-foreground text-sm">
            {check.lastCheckedAt
              ? t("last", {
                  last: day(check.lastCheckedAt),
                  next: check.nextCheckAt ? day(check.nextCheckAt) : "",
                })
              : t("first")}
          </p>
        ) : null}
        {failed.length > 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("sourceFailed", {
              sources: failed.map((source) => t(`source.${source}`)).join(", "),
            })}
          </p>
        ) : null}
        {needs.map((need) => (
          <p className="text-muted-foreground text-sm" key={need}>
            {need}
          </p>
        ))}
        {readOnly ? null : (
          <div className="flex flex-wrap items-center gap-2">
            {check.on ? (
              <>
                {check.lastCheckedAt ? null : (
                  <Button
                    disabled={pending !== null || competitorCount === 0}
                    loading={pending === "run"}
                    onClick={runNow}
                    size="sm"
                    variant="primary"
                  >
                    {t("runNow")}
                  </Button>
                )}
                <Button
                  disabled={pending !== null}
                  loading={pending === "switch"}
                  onClick={() => turn(false)}
                  size="sm"
                >
                  {t("turnOff")}
                </Button>
              </>
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
        {message ? (
          <p className="text-sm" role="alert">
            {message}
          </p>
        ) : null}
      </CompetitorsItem>
    </CompetitorsPanel>
  );
}
