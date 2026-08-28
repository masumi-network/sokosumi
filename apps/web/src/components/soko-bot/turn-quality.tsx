import { getTranslations } from "next-intl/server";

import { MetaGrid } from "@/components/soko-bot/meta-grid";
import { StatusBadge } from "@/components/soko-bot/status-badge";
import type { SokoBotQualityVerdict } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

/** The four dimensions, in the order the rubric lists them. */
const DIMENSIONS = [
  "delegation",
  "followThrough",
  "judgment",
  "honesty",
] as const;

function toneForScore(score: number): string {
  if (score >= 4) return "text-semantic-success";
  if (score >= 3) return "text-semantic-warning";
  return "text-semantic-destructive";
}

export interface TurnQualityProps {
  score: number | null | undefined;
  verdict: SokoBotQualityVerdict | null | undefined;
  /** Judge model that graded the turn. */
  model: string | null | undefined;
  judgedAt: string | null | undefined;
  /** Turns the bot started itself are graded against the proactive rubric. */
  source: string;
}

/**
 * Explains a turn's score instead of just showing it: which judge graded it,
 * against which rubric, what each dimension scored, and how those combine.
 */
export async function TurnQuality({
  score,
  verdict,
  model,
  judgedAt,
  source,
}: TurnQualityProps) {
  const t = await getTranslations("App.Admin.SokoBots.Turns.Quality");
  if (score === null || score === undefined) {
    return <p className="text-muted-foreground text-xs">{t("notJudged")}</p>;
  }
  const proactive = source !== "CHAT";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "text-lg font-medium tabular-nums",
            toneForScore(score),
          )}
        >
          {score}/5
        </span>
        {verdict ? (
          <StatusBadge
            tone={
              verdict.verdict === "pass"
                ? "success"
                : verdict.verdict === "weak"
                  ? "warning"
                  : "danger"
            }
          >
            {t(`verdict.${verdict.verdict}`)}
          </StatusBadge>
        ) : null}
        <span className="text-muted-foreground text-xs">
          {t("rubricUsed", {
            rubric: proactive ? t("rubric.proactive") : t("rubric.owner"),
          })}
        </span>
      </div>

      <p className="text-muted-foreground text-xs">{t("howScored")}</p>

      {verdict ? (
        <MetaGrid
          columns={4}
          items={DIMENSIONS.map((dimension) => ({
            label: t(`dimension.${dimension}`),
            value: `${verdict.scores[dimension]}/5`,
          }))}
        />
      ) : null}

      <MetaGrid
        columns={2}
        items={[
          { label: t("judgeModel"), value: model ?? null, mono: true },
          { label: t("judgedAt"), value: judgedAt ?? null },
        ]}
      />

      {verdict?.rationale ? (
        <div className="space-y-1">
          <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {t("rationale")}
          </h4>
          <p className="text-sm">{verdict.rationale}</p>
        </div>
      ) : null}

      {verdict && verdict.issues.length > 0 ? (
        <div className="space-y-1">
          <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {t("issues")}
          </h4>
          <ul className="list-inside list-disc space-y-0.5 text-sm">
            {verdict.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
