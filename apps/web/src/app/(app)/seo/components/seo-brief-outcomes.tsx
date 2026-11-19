import type { SeoAuditBrief } from "@sokosumi/core-client";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { SeoPeriod } from "./seo-shared";

type FollowUp = SeoAuditBrief["followUps"][number];
type Observation = NonNullable<FollowUp["outcomes"]>[number]["latest"];

export function SeoBriefOutcomes({ followUp }: { followUp: FollowUp }) {
  const t = useSeoResultTranslations("App.Seo.brief.events");
  if (!followUp.outcomes) return null;
  if (!followUp.outcomes.length) {
    return followUp.changedAt ? (
      <p className="text-muted-foreground">{t("missing")}</p>
    ) : null;
  }
  const hasComparison = followUp.outcomes.some((outcome) => outcome.comparison);
  return (
    <section
      lang="en"
      aria-label={t("title")}
      className="space-y-2 border-t pt-2"
    >
      <h4 className="font-medium">{t("title")}</h4>
      <p className="text-muted-foreground">{t("source")}</p>
      {followUp.outcomes.map(({ event, latest, comparison }) => (
        <div className="space-y-1.5" key={event}>
          <h5 className="font-medium">
            {t(event)}{" "}
            <span className="text-muted-foreground text-xs">
              (<code>{event}</code>)
            </span>
          </h5>
          <dl className="space-y-1">
            {comparison && (
              <>
                <PeriodCount label={t("before")} period={comparison.before} />
                <PeriodCount label={t("after")} period={comparison.after} />
              </>
            )}
            {(!comparison ||
              latest.from !== comparison.after.from ||
              latest.to !== comparison.after.to ||
              latest.count !== comparison.after.count) && (
              <PeriodCount label={t("latest")} period={latest} />
            )}
          </dl>
          {followUp.changedAt && !comparison && (
            <p className="text-muted-foreground">{t("noComparison")}</p>
          )}
        </div>
      ))}
      {hasComparison && (
        <p className="text-muted-foreground">{t("observed")}</p>
      )}
    </section>
  );
}

function PeriodCount({
  label,
  period,
}: {
  label: string;
  period: Observation;
}) {
  const t = useSeoResultTranslations("App.Seo.brief.events");
  return (
    <div className="text-sm">
      <dt>{label}</dt>
      <dd className="text-muted-foreground tabular-nums">
        <SeoPeriod report from={period.from} to={period.to} /> ·{" "}
        {t("count", { count: period.count })}
      </dd>
    </div>
  );
}
