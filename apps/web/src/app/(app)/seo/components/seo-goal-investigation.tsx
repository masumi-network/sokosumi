import type { SeoAuditBrief } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";
import { SeoPeriod } from "./seo-shared";

type FollowUp = SeoAuditBrief["followUps"][number];
type Control = NonNullable<
  SeoAuditBrief["followUps"][number]["goalInvestigation"]
>;
export function SeoGoalInvestigation({ control }: { control: Control }) {
  const t = useTranslations("App.Seo.brief.goalControl");
  const format = useFormatter();
  return (
    <section className="space-y-2 border-t pt-2">
      <h4 className="font-medium">{t("title", { event: control.event })}</h4>
      <dl className="space-y-1">
        {[control.before, control.after].map((period) => (
          <div key={period.from}>
            <dt>
              <SeoPeriod from={period.from} to={period.to} />
            </dt>
            <dd className="text-muted-foreground tabular-nums">
              {t("rates", {
                organic: format.number(period.organic.rate, {
                  style: "percent",
                  maximumFractionDigits: 1,
                }),
                organicSessions: period.organic.sessions,
                direct: format.number(period.direct.rate, {
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
  const t = useTranslations("App.Seo.brief.goalControl");
  const format = useFormatter();
  const period = followUp.latestClosedGoal;
  if (!period) return null;
  const completedDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: period.timeZone,
  }).format(new Date(completedAt));
  if (period.from <= completedDay) return null;
  return (
    <section className="space-y-1 border-t pt-2">
      <h4 className="font-medium">
        {t("afterTask", {
          date: format.dateTime(new Date(completedAt), {
            dateStyle: "medium",
            timeZone: period.timeZone,
          }),
        })}
      </h4>
      <p>
        <SeoPeriod from={period.from} to={period.to} /> ·{" "}
        {t("events", { count: period.count, event: period.event })}
      </p>
      <p className="text-muted-foreground">{t("attribution")}</p>
    </section>
  );
}
