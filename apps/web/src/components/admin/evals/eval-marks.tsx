import type {
  EvalOutcome,
  EvalResultStatus,
  EvalRun,
} from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { GITHUB_REPOSITORY_URL } from "@/lib/constants/admin-evals";
import { cn } from "@/lib/utils";

/**
 * The marks every eval view shares. Colour stays for the two outcomes that
 * call for action: a regression is the solid Neutral 950 chip, a fix the
 * green fill. Everything else is weight and glyph on neutrals.
 */
const OUTCOME_CLASSES: Record<EvalOutcome, string> = {
  regressed: "bg-foreground text-background border-transparent",
  error: "border-foreground border-dashed text-foreground",
  failing: "border-foreground text-foreground",
  flaky: "border-border text-foreground border-dashed",
  fixed:
    "bg-semantic-success text-semantic-success-foreground border-transparent",
  passing: "border-transparent text-muted-foreground",
  pending: "border-border text-muted-foreground",
  skipped: "border-transparent text-muted-foreground",
};

export function EvalOutcomeBadge({ outcome }: { outcome: EvalOutcome }) {
  const t = useTranslations("App.Admin.Evals.Outcome");
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-md border px-2 text-xs font-medium whitespace-nowrap",
        OUTCOME_CLASSES[outcome],
      )}
    >
      {t(outcome)}
    </span>
  );
}

const STATE_CLASSES: Record<EvalResultStatus, string> = {
  PASSED: "bg-foreground border-foreground",
  FAILED: "border-foreground",
  ERROR: "border-foreground border-dashed",
  SKIPPED: "bg-muted border-transparent",
  PENDING: "bg-quinary border-border",
  RUNNING: "bg-quinary border-foreground motion-safe:animate-pulse",
};

/** One square per repeat: filled passed, hollow failed, dashed error. */
export function EvalRepeatMarks({ states }: { states: EvalResultStatus[] }) {
  const t = useTranslations("App.Admin.Evals.State");
  return (
    <span className="inline-flex items-center gap-1">
      {states.map((state, index) => (
        <span
          // Repeats are positional: the index is the identity.
          key={index}
          title={t(state)}
          className={cn("size-2.5 rounded-sm border", STATE_CLASSES[state])}
        >
          <span className="sr-only">{t(state)}</span>
        </span>
      ))}
    </span>
  );
}

/** Earlier daily runs, oldest on the left: bar height is the pass rate. */
export function EvalHistoryStrip({ history }: { history: (number | null)[] }) {
  const t = useTranslations("App.Admin.Evals");
  const oldestFirst = [...history].reverse();
  if (oldestFirst.length === 0)
    return (
      <span className="text-muted-foreground text-xs">{t("noHistory")}</span>
    );
  return (
    <span
      className="inline-flex h-4 items-end gap-0.5"
      aria-label={t("historyLabel", { count: history.length })}
    >
      {oldestFirst.map((rate, index) => (
        <span
          key={index}
          className="bg-muted flex h-4 w-1.5 items-end overflow-hidden rounded-xs"
        >
          {rate === null ? null : (
            <span
              className="bg-foreground w-full"
              style={{ height: `${Math.max(rate * 100, 8)}%` }}
            />
          )}
        </span>
      ))}
    </span>
  );
}

export function formatPassRate(rate: number | null | undefined): string {
  return rate === null || rate === undefined
    ? "–"
    : `${Math.round(rate * 100)}%`;
}

/** "#6931" linked to the PR, else the short commit, else nothing to link. */
export function EvalCommitRef({
  run,
}: {
  run: Pick<EvalRun, "prNumber" | "commitSha">;
}) {
  if (run.prNumber)
    return (
      <a
        href={`${GITHUB_REPOSITORY_URL}/pull/${run.prNumber}`}
        target="_blank"
        rel="noreferrer"
        className="font-mono tabular-nums underline-offset-4 hover:underline"
      >
        #{run.prNumber}
      </a>
    );
  if (run.commitSha)
    return (
      <a
        href={`${GITHUB_REPOSITORY_URL}/commit/${run.commitSha}`}
        target="_blank"
        rel="noreferrer"
        className="font-mono tabular-nums underline-offset-4 hover:underline"
      >
        {run.commitSha.slice(0, 7)}
      </a>
    );
  return <span className="text-muted-foreground">–</span>;
}

export function formatCost(usd: number | null | undefined): string {
  if (usd === null || usd === undefined) return "–";
  return usd < 0.01 && usd > 0 ? "<$0.01" : `$${usd.toFixed(2)}`;
}
