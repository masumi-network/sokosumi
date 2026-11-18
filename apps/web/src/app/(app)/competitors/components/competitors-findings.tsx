import type { ProjectCompetitors } from "@sokosumi/core-client";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";

import {
  CompetitorsEmpty,
  CompetitorsItem,
  CompetitorsPanel,
} from "./competitors-panel";
import { CompetitorsSource } from "./competitors-source";

/**
 * Everything the checks stored in the last weeks, newest first: what
 * happened in one line, the source's own words, and where to read it.
 * Instagram readings are numbers and show on the scoreboard instead.
 */
export async function CompetitorsFindings({
  data,
}: {
  data: ProjectCompetitors;
}) {
  const t = await getTranslations("App.Competitors.findings");
  const names = new Map(data.competitors.map((c) => [c.id, c.name]));
  const findings = data.signals.filter((signal) => signal.kind !== "SOCIAL");

  return (
    <CompetitorsPanel
      aside={findings.length > 0 ? String(findings.length) : null}
      id="competitors-findings"
      title={t("title")}
    >
      {findings.length === 0 ? (
        <CompetitorsEmpty>
          {data.check.lastCheckedAt ? t("nothing") : t("notChecked")}
        </CompetitorsEmpty>
      ) : (
        findings.map((signal) => (
          <CompetitorsItem className="flex flex-col gap-1" key={signal.id}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">
                {names.get(signal.competitorId)}
              </span>
              <Badge variant="outline">{t(`kind.${signal.kind}`)}</Badge>
            </div>
            <p className="text-sm">{signal.summary}</p>
            {signal.quote ? (
              <blockquote className="text-muted-foreground border-l-2 pl-3 text-sm">
                {signal.quote}
              </blockquote>
            ) : null}
            <CompetitorsSource signal={signal} />
          </CompetitorsItem>
        ))
      )}
    </CompetitorsPanel>
  );
}
