import type { ProjectCompetitors } from "@sokosumi/core-client";
import { getFormatter, getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";

import {
  CompetitorsEmpty,
  CompetitorsItem,
  CompetitorsPanel,
} from "./competitors-panel";
import { CompetitorsSource } from "./competitors-source";

/**
 * This week: each competitor move with the facts behind it and their
 * sources, what it means for the business and one suggested move.
 */
export async function CompetitorsThisWeek({
  data,
}: {
  data: ProjectCompetitors;
}) {
  const t = await getTranslations("App.Competitors.thisWeek");
  const format = await getFormatter();
  const { feed } = data;
  const names = new Map(data.competitors.map((c) => [c.id, c.name]));
  const signals = new Map(data.signals.map((signal) => [signal.id, signal]));

  return (
    <CompetitorsPanel
      aside={
        feed
          ? t("checked", {
              date: format.dateTime(new Date(feed.checkDay), {
                day: "numeric",
                month: "short",
                timeZone: "UTC",
              }),
            })
          : null
      }
      id="competitors-this-week"
      title={t("title")}
    >
      {!feed ? (
        <CompetitorsEmpty>{t("none")}</CompetitorsEmpty>
      ) : feed.items.length === 0 ? (
        <CompetitorsEmpty>{t("quiet")}</CompetitorsEmpty>
      ) : (
        feed.items.map((item) => (
          <CompetitorsItem className="flex flex-col gap-3" key={item.id}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">
                {names.get(item.competitorId) ?? t("unknown")}
              </h3>
              {item.big ? <Badge variant="outline">{t("big")}</Badge> : null}
            </div>
            <ul className="flex flex-col gap-2">
              {item.facts.map((fact) => (
                <li className="text-sm" key={fact.text}>
                  {fact.text}{" "}
                  {fact.support === "weak" ? (
                    <Badge className="mr-1" variant="outline">
                      {t("weak")}
                    </Badge>
                  ) : null}
                  <span className="inline-flex flex-wrap gap-x-2">
                    {fact.signalIds.map((id) => {
                      const signal = signals.get(id);
                      return signal ? (
                        <CompetitorsSource key={id} signal={signal} />
                      ) : null;
                    })}
                  </span>
                </li>
              ))}
            </ul>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground text-xs">
                  {t("meaning")}
                </dt>
                <dd className="text-sm">{item.meaning}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">{t("move")}</dt>
                <dd className="text-sm">{item.move}</dd>
              </div>
            </dl>
          </CompetitorsItem>
        ))
      )}
      {feed && feed.openQuestions.length > 0 ? (
        <CompetitorsItem>
          <p className="text-muted-foreground text-xs">{t("open")}</p>
          <ul className="mt-1 list-disc pl-4 text-sm">
            {feed.openQuestions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </CompetitorsItem>
      ) : null}
    </CompetitorsPanel>
  );
}
