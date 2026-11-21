import { seoResultFormat } from "@/i18n/seo-result-messages";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { contentPlanningIdeas } from "./seo-content-planning-model";
import type { SeoKeywordGroup } from "./seo-keyword-rows-model";
import { SeoPageText, seoMarketName } from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoContentPlanning({
  groups,
  model,
  gapsOnly = false,
}: {
  groups: SeoKeywordGroup[];
  model: SeoWorkspaceModel;
  gapsOnly?: boolean;
}) {
  const t = useSeoResultTranslations("App.Seo.keywords.planning");
  const plans = contentPlanningIdeas(groups).filter(
    (plan) => !gapsOnly || plan.gap,
  );
  if (!plans.length) return null;
  return (
    <ul className="space-y-3 py-2 text-sm" lang="en">
      {plans.map(({ idea, gap, related }) => (
        <li key={idea.id}>
          <p className="font-medium">
            {idea.editorial?.angle?.nextStep ??
              t(gap ? "gap" : "idea", {
                keyword: idea.keyword,
                feature: idea.feature!,
              })}
          </p>
          {idea.editorial?.angle && (
            <p>
              <bdi lang={idea.languageCode}>{idea.keyword}</bdi>
            </p>
          )}
          <SeoPageText url={idea.pageUrl!} workspace={model.data} />
          <p>
            {t("basis", {
              volume: idea.volume!,
              market: seoMarketName("en", idea.countryCode, idea.languageCode),
            })}
          </p>
          {related.length > 0 && (
            <p>{t("related", { queries: seoResultFormat.list(related) })}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
