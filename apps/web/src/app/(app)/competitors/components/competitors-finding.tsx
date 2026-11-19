import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";

import { CompetitorsItem } from "./competitors-panel";

/**
 * One thing a check found: who, what kind, what happened in one line, the
 * source's own words, and where to read it.
 */
export function CompetitorsFinding({
  name,
  kind,
  summary,
  quote,
  source,
}: {
  name: string;
  kind: string;
  summary: string;
  quote: string | null;
  source: ReactNode;
}) {
  return (
    <CompetitorsItem className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{name}</span>
        <Badge variant="outline">{kind}</Badge>
        <span className="ms-auto">{source}</span>
      </div>
      <p className="text-sm">{summary}</p>
      {quote ? (
        <blockquote className="text-muted-foreground border-l-2 pl-3 text-sm">
          {quote}
        </blockquote>
      ) : null}
    </CompetitorsItem>
  );
}

const EXAMPLES = [
  { key: "price", kind: "PRICE_CHANGE" },
  { key: "news", kind: "NEWS" },
  { key: "website", kind: "WEBSITE_CHANGE" },
] as const;

/**
 * What a week's findings look like, with made-up companies: shown where the
 * Project has none yet, so the page says what the check gives before it is
 * turned on. Each row is marked as an example.
 */
export function CompetitorsExample() {
  const t = useTranslations("App.Competitors");
  return (
    <ul aria-label={t("example.label")} className="flex flex-col gap-2">
      {EXAMPLES.map(({ key, kind }) => (
        <li key={key}>
          <CompetitorsFinding
            kind={t(`findings.kind.${kind}`)}
            name={t(`example.${key}.name`)}
            quote={t(`example.${key}.quote`)}
            source={
              <span className="text-muted-foreground text-xs">
                {t(`example.${key}.source`)}
              </span>
            }
            summary={t(`example.${key}.summary`)}
          />
        </li>
      ))}
    </ul>
  );
}
