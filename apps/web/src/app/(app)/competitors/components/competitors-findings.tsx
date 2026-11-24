import type { ProjectCompetitors } from "@sokosumi/core-client";
import { getTranslations } from "next-intl/server";
import { PageSearchRows } from "@/components/page-list-search";

import { CompetitorsExample, CompetitorsFinding } from "./competitors-finding";
import { CompetitorsEmpty, CompetitorsPanel } from "./competitors-panel";
import { CompetitorsSource } from "./competitors-source";
import { showsExample } from "./competitors-view";

const SOURCES = ["news", "ads", "social"] as const;

/**
 * Everything the checks stored in the last weeks, newest first: what
 * happened in one line, the source's own words, and where to read it.
 * Instagram readings are numbers and show on the scoreboard instead. Before
 * the first check it shows an example of a week instead of an empty box.
 */
export async function CompetitorsFindings({
  data,
}: {
  data: ProjectCompetitors;
}) {
  const t = await getTranslations("App.Competitors.findings");
  const names = new Map(data.competitors.map((c) => [c.id, c.name]));
  const findings = data.signals.filter((signal) => signal.kind !== "SOCIAL");
  const { check } = data;
  // What a source needs before it can be read, said where its findings go.
  const needs = SOURCES.flatMap((source) => check.sources[source].needs ?? []);

  if (showsExample(data))
    return (
      <CompetitorsPanel
        aside={t("example")}
        id="competitors-findings"
        title={t("preview")}
      >
        <CompetitorsExample />
      </CompetitorsPanel>
    );

  return (
    <CompetitorsPanel
      aside={findings.length > 0 ? String(findings.length) : null}
      id="competitors-findings"
      title={t("title")}
    >
      {findings.length === 0 ? (
        <CompetitorsEmpty>
          {check.lastCheckedAt ? t("nothing") : t("running")}
        </CompetitorsEmpty>
      ) : (
        <PageSearchRows
          rows={findings.map((signal) => ({
            primary: [signal.summary, names.get(signal.competitorId)],
            secondary: [signal.quote, t(`kind.${signal.kind}`)],
            content: (
              <CompetitorsFinding
                key={signal.id}
                kind={t(`kind.${signal.kind}`)}
                name={names.get(signal.competitorId) ?? ""}
                quote={signal.quote}
                source={<CompetitorsSource signal={signal} />}
                summary={signal.summary}
              />
            ),
          }))}
        />
      )}
      {needs.length > 0 ? (
        <p className="text-muted-foreground px-2 pb-1 text-xs">
          {needs.join(" ")}
        </p>
      ) : null}
    </CompetitorsPanel>
  );
}
