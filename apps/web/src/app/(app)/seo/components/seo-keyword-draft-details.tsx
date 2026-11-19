import { Bot, PencilLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOptionalNewTaskWizard } from "@/app/components/new-task-wizard-provider";
import { Button } from "@/components/ui/button";
import { SEO_RESULT_LOCALE } from "@/i18n/seo-result-messages";
import {
  useSeoResultFormatter,
  useSeoResultTranslations,
} from "@/i18n/use-seo-result-translations";
import { seoClickGain, seoKeywordBriefSite } from "./seo-keyword-map-model";
import {
  MEDIUM_DIFFICULTY_FROM,
  recommendation,
} from "./seo-keyword-recommendations";
import {
  SEO_IDEA_SOURCES,
  type SeoKeywordGroup,
  seoDifficultyBand,
} from "./seo-keyword-rows-model";
import { SeoPageText, seoMarketName } from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoKeywordDraftDetails({
  group,
  model,
  idea = true,
  onLeave,
  track,
}: {
  group: SeoKeywordGroup;
  model: SeoWorkspaceModel;
  idea?: boolean;
  onLeave?: () => void;
  track?: React.ReactNode;
}) {
  const t = useTranslations("App.Seo");
  const result = useSeoResultTranslations("App.Seo");
  const { pageUrl, targetPageId } = group.lead;
  const page = model.data.pages.find((item) =>
    pageUrl ? item.url === pageUrl : item.id === targetPageId,
  );
  const action = model.brief?.data?.pages.find(
    (goal) => goal.pageId === page?.id,
  )?.action;
  const reason = idea ? recommendation(group) : null;
  const url = pageUrl ?? page?.url;
  const format = useSeoResultFormatter();
  const wizard = useOptionalNewTaskWizard();
  const { lead } = group;
  const band = seoDifficultyBand(group.difficulty);
  const gain = seoClickGain(group.clicks);
  const sources = idea
    ? SEO_IDEA_SOURCES.filter((source) => group.sources.includes(source))
    : [];
  const facts = {
    measured: group.volume !== null && band ? "yes" : "no",
    keyword: lead.keyword,
    volume: group.volume ?? "",
    market: seoMarketName(
      SEO_RESULT_LOCALE,
      lead.countryCode,
      lead.languageCode,
    ),
    // Inside a sentence the band is a plain word.
    difficulty: band
      ? result(`keywords.difficulty.${band}`).toLocaleLowerCase(
          SEO_RESULT_LOCALE,
        )
      : "",
    value: group.difficulty === null ? "" : Math.round(group.difficulty),
    site: seoKeywordBriefSite(lead.pageUrl, model.data),
    feature: group.feature ?? "none",
  };

  return (
    <div className="grid min-w-0 gap-3 text-sm [overflow-wrap:anywhere]">
      {reason && (
        <div lang="en" className="space-y-1">
          <p className="font-medium">
            {result(`keywords.recommendation.${reason}`)}
          </p>
          {(reason === "both" || reason === "competition") &&
            group.difficulty !== null && (
              <p className="text-xs">
                {result("keywords.recommendation.easeEvidence", {
                  value: group.difficulty,
                  limit: MEDIUM_DIFFICULTY_FROM,
                })}
              </p>
            )}
          {(reason === "both" || reason === "goal") && (
            <p className="text-xs">
              {result("keywords.recommendation.goalEvidence")}
            </p>
          )}
        </div>
      )}
      {gain && (
        <div
          lang="en"
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
        >
          <span className="text-muted-foreground text-xs">
            {result("keywords.map.estimatedGain")}
          </span>
          <span className="inline-flex flex-wrap gap-x-3">
            {([10, 3] as const).map((rank) => {
              const clicks = rank === 10 ? gain.top10 : gain.top3;
              return (
                <span
                  key={rank}
                  className="whitespace-nowrap text-xs font-medium tabular-nums"
                >
                  {clicks === 0
                    ? result(
                        rank === 10
                          ? "keywords.map.top10"
                          : "keywords.map.top3",
                        { clicks },
                      )
                    : result("keywords.map.rankGain", {
                        rank,
                        gain: format.number(clicks, { signDisplay: "always" }),
                      })}
                </span>
              );
            })}
          </span>
        </div>
      )}
      <div lang="en" className="grid gap-1 empty:hidden">
        {url && (
          <div>
            <span className="text-xs font-medium">
              {result("keywords.recommendation.page")}
            </span>
            <SeoPageText url={url} workspace={model.data} />
          </div>
        )}
        {action && (
          <p className="text-xs">
            {result("keywords.recommendation.action", {
              action: result(`brief.actions.${action.replaceAll(" ", "_")}`),
            })}
          </p>
        )}
        {group.feature && (
          <p className="text-muted-foreground text-xs">
            {result.rich("keywords.conversion.feature", {
              feature: () => <bdi>{group.feature}</bdi>,
            })}
          </p>
        )}
        {sources.length > 0 && (
          <p className="text-muted-foreground text-xs">
            {sources
              .map((source) => result(`keywords.ideas.source.${source}`))
              .join(" · ")}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        {wizard ? (
          <Button
            size="sm"
            onClick={() => {
              onLeave?.();
              // The Task gets the order to write; the agent gets a question, so it advises before it writes.
              wizard.openNewTaskWizard({
                prompt: result("keywords.map.brief", facts),
                projectId: model.data.projectId ?? null,
              });
            }}
          >
            <PencilLine />
            {t("keywords.map.contentTask")}
          </Button>
        ) : null}

        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            onLeave?.();
            model.openChat(result("keywords.map.question", facts));
          }}
        >
          <Bot />
          {t("keywords.map.ask")}
        </Button>

        {track}
        <Button
          size="sm"
          variant="ghost"
          disabled
          className="h-auto min-h-8 whitespace-normal"
        >
          {t("keywords.recommendation.studio")}
        </Button>
      </div>
    </div>
  );
}
