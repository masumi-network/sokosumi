"use client";

import {
  type LucideIcon,
  MousePointerClick,
  Search,
  TrendingUp,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SeoTab } from "../seo-query";
import { SeoPeriod } from "./seo-shared";
import type { seoSearchTraffic } from "./seo-statistics-model";
import { seoSummary } from "./seo-summary-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/**
 * The icon of each figure; the chart of the same numbers has it too. Keywords found in Google's results, the
 * searches for them, and the clicks from Google search.
 */
export const SEO_FIGURE_ICON = {
  rankings: Search,
  searches: TrendingUp,
  clicks: MousePointerClick,
} satisfies Record<string, LucideIcon>;

/** One figure: a small tinted chip that opens the tab behind its number. The icon has the colour of its chart. */
function Figure({
  tint,
  icon: Icon,
  iconClass,
  onOpen,
  testId,
  children,
}: {
  tint: string;
  icon: LucideIcon;
  iconClass: string;
  onOpen: () => void;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        data-testid={testId}
        className={cn(
          // A figure is about 28px high: the wrap gap keeps two rows of figures apart, with no hit area over the next.
          "focus-visible:ring-ring press inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums outline-none hover:brightness-95 focus-visible:ring-2 forced-colors:border",
          tint,
        )}
        onClick={onOpen}
      >
        <Icon aria-hidden className={cn("size-3.5 shrink-0", iconClass)} />
        {children}
      </button>
    </li>
  );
}

/**
 * The numbers under the agent's verdict: keywords in Google's top results, the searches for them, and the
 * clicks from Google search. Each opens the tab that lists them.
 */
export function SeoAgentFigures({
  model,
  traffic,
  periodId,
  trafficLead,
}: {
  model: SeoWorkspaceModel;
  traffic: ReturnType<typeof seoSearchTraffic>;
  /** The id of the period of the traffic figure: the verdict names it when the search numbers are its headline. */
  periodId: string;
  /** The search numbers are the verdict: the figure names their period only, so it does not repeat them. */
  trafficLead: boolean;
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const { keywords, searches } = seoSummary(model.data);
  if (!keywords && !searches && !traffic) return null;
  // A figure counts every keyword, so the tab it opens drops a search left from a keyword of the picture.
  const open = (tab: SeoTab) => () => {
    model.setKeywordSearch("");
    void model.setFilters({ tab });
  };
  return (
    <ul
      role="list"
      aria-label={t("agent.figures.label")}
      className="flex flex-wrap gap-2"
      data-testid="seo-agent-figures"
    >
      {keywords ? (
        <Figure
          // A keyword found is good news; none is no alarm, so it stays neutral.
          tint={keywords.found ? "bg-chart-2-quinary" : "bg-quinary"}
          icon={SEO_FIGURE_ICON.rankings}
          iconClass={keywords.found ? "text-chart-2" : "text-muted-foreground"}
          onOpen={open("rankings")}
        >
          {/* "0 of 8" is no "not in Google": the count holds for the results the check read, so it names them. */}
          {t("agent.figures.rankings", {
            found: format.number(keywords.found),
            read: format.number(keywords.read),
            // The plural reads the number itself: "1.000" in German would count as one.
            count: keywords.read,
            depth: keywords.depth
              ? keywords.depth.min === keywords.depth.max
                ? "same"
                : "range"
              : "none",
            min: keywords.depth?.min ?? 0,
            max: keywords.depth?.max ?? 0,
          })}
        </Figure>
      ) : null}
      {searches ? (
        <Figure
          tint="bg-chart-4-quinary"
          icon={SEO_FIGURE_ICON.searches}
          iconClass="text-chart-4"
          onOpen={open("rankings")}
        >
          {t("agent.figures.searches", {
            // The message formats the numbers itself, so its plural reads the number.
            total: searches.total,
            // Not every checked keyword has a number of searches: the figure says for how many.
            partial: searches.keywords === searches.of ? "no" : "yes",
            keywords: searches.keywords,
            of: searches.of,
          })}
        </Figure>
      ) : null}
      {traffic ? (
        <Figure
          tint="bg-chart-5-quinary"
          icon={SEO_FIGURE_ICON.clicks}
          iconClass="text-chart-5"
          onOpen={open("traffic")}
          testId="seo-agent-traffic"
        >
          {trafficLead
            ? null
            : t("agent.figures.traffic", {
                clicks: traffic.clicks,
                impressions: traffic.impressions,
              })}
          {/* The period is in the figure's name; it shows where it is the figure's only text. There the name
              also says where the figure leads. */}
          {trafficLead ? (
            <span className="sr-only">{`${t("tabs.traffic")}: `}</span>
          ) : null}
          <span id={periodId} className={cn(!trafficLead && "sr-only")}>
            {trafficLead ? null : ", "}
            <SeoPeriod from={traffic.period.from} to={traffic.period.to} />
          </span>
        </Figure>
      ) : null}
    </ul>
  );
}
