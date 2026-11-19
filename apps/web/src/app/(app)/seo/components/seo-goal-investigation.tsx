import type { SeoAuditBrief } from "@sokosumi/core-client";
import { seoResultFormat } from "@/i18n/seo-result-messages";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { SeoPeriod } from "./seo-shared";

type FollowUp = SeoAuditBrief["followUps"][number];
type Control = NonNullable<
  SeoAuditBrief["followUps"][number]["goalInvestigation"]
>;
export function SeoGoalInvestigation({ control }: { control: Control }) {
  const t = useSeoResultTranslations("App.Seo.brief.goalControl");
  return (
    <section lang="en" className="space-y-2 border-t pt-2">
      <h4 className="font-medium">{t("title", { event: control.event })}</h4>
      <dl className="space-y-1">
        {[control.before, control.after].map((period) => (
          <div key={period.from}>
            <dt>
              <SeoPeriod report from={period.from} to={period.to} />
            </dt>
            <dd className="text-muted-foreground tabular-nums">
              {t("rates", {
                organic: seoResultFormat.number(period.organic.rate, {
                  style: "percent",
                  maximumFractionDigits: 1,
                }),
                organicSessions: period.organic.sessions,
                direct: seoResultFormat.number(period.direct.rate, {
                  style: "percent",
                  maximumFractionDigits: 1,
                }),
                directSessions: period.direct.sessions,
              })}
            </dd>
          </div>
        ))}
      </dl>
      {control.weekdayMix === "uneven" && (
        <p className="text-muted-foreground">{t("weekdayMix")}</p>
      )}
      <p>{t(control.assessment)}</p>
    </section>
  );
}

export function SeoActionOutcome({
  followUp,
  completedAt,
}: {
  followUp: FollowUp;
  completedAt: Date;
}) {
  const t = useSeoResultTranslations("App.Seo.brief.goalControl");
  const period = followUp.latestClosedGoal;
  if (!period) return null;
  const completedDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: period.timeZone,
  }).format(new Date(completedAt));
  if (period.from <= completedDay) return null;
  return (
    <section lang="en" className="space-y-1 border-t pt-2">
      <h4 className="font-medium">
        {t("afterTask", {
          date: seoResultFormat.dateTime(new Date(completedAt), {
            dateStyle: "medium",
            timeZone: period.timeZone,
          }),
        })}
      </h4>
      <p>
        <SeoPeriod report from={period.from} to={period.to} /> ·{" "}
        {t("events", { count: period.count, event: period.event })}
      </p>
      <p className="text-muted-foreground">{t("attribution")}</p>
    </section>
  );
}
