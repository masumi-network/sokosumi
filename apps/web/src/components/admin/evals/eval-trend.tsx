import type { EvalRunListItem } from "@sokosumi/core-client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { adminEvalRunHref } from "@/lib/constants/admin-evals";
import { cn } from "@/lib/utils";
import { formatPassRate } from "./eval-marks";

/** What the bots ran on, so a change of version or model shows on the trend. */
function versionKey(run: EvalRunListItem, suite: string): string {
  return suite === "cmo"
    ? `${run.models.cusoVersionId ?? ""} ${run.models.cusoModel ?? ""}`
    : `${run.models.sokoBotVersionId ?? ""} ${run.models.sokoBotModel ?? ""}`;
}

function versionLabel(run: EvalRunListItem, suite: string): string | null {
  return suite === "cmo"
    ? (run.models.cusoVersionId ?? null)
    : (run.models.sokoBotVersionId ?? null);
}

/**
 * One suite's pass rate per daily run, oldest on the left. Each bar is a run
 * on main, labelled by the PR it ran after; a run on a new version or model
 * carries the version above its bar.
 */
export function EvalTrend({
  suite,
  runs,
}: {
  suite: "soko-bot" | "cmo";
  runs: EvalRunListItem[];
}) {
  const t = useTranslations("App.Admin.Evals");
  const daily = runs
    .filter(
      (run) =>
        run.trigger === "DAILY" &&
        run.status === "COMPLETED" &&
        run.scores[suite]?.passRate !== null &&
        run.scores[suite] !== undefined,
    )
    .reverse();
  const latest = daily.at(-1);
  return (
    <section className={cn(HOLDER_ITEM_CLASS, "flex flex-col gap-3 p-4")}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">{t(`Suite.${suite}`)}</h2>
        <p className="text-2xl font-semibold tabular-nums">
          {formatPassRate(latest?.scores[suite]?.passRate)}
        </p>
      </div>
      {daily.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("noDailyRuns")}</p>
      ) : (
        <ol className="flex h-28 items-end gap-1 overflow-x-auto">
          {daily.map((run, index) => {
            const score = run.scores[suite];
            const rate = score?.passRate ?? 0;
            const changed =
              index > 0 &&
              versionKey(run, suite) !== versionKey(daily[index - 1], suite);
            return (
              <li key={run.id} className="flex h-full min-w-6 flex-col">
                <span className="text-muted-foreground h-4 truncate text-2xs">
                  {changed ? versionLabel(run, suite) : ""}
                </span>
                <Link
                  href={adminEvalRunHref(run.id)}
                  title={t("trendBarTitle", {
                    rate: formatPassRate(rate),
                    passed: score?.passed ?? 0,
                    scored: score?.scored ?? 0,
                  })}
                  className="bg-muted hover:bg-quinary flex flex-1 items-end rounded-sm transition-colors"
                >
                  <span
                    className={cn(
                      "bg-foreground w-full rounded-sm",
                      changed && "ring-2 ring-ring",
                    )}
                    style={{ height: `${Math.max(rate * 100, 4)}%` }}
                  />
                </Link>
                <span className="text-muted-foreground mt-1 h-4 text-center font-mono text-2xs tabular-nums">
                  {run.prNumber ? `#${run.prNumber}` : ""}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function EvalTrends({ runs }: { runs: EvalRunListItem[] }) {
  return (
    <div className={cn(HOLDER_CLASS, "grid gap-2 md:grid-cols-2")}>
      <EvalTrend suite="soko-bot" runs={runs} />
      <EvalTrend suite="cmo" runs={runs} />
    </div>
  );
}
