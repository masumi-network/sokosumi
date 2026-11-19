import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  MEDIUM_DIFFICULTY_FROM,
  recommendation,
} from "./seo-keyword-recommendations";
import type { SeoKeywordGroup } from "./seo-keyword-rows-model";
import { SeoPageText } from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoKeywordDraftDetails({
  group,
  model,
  idea = true,
}: {
  group: SeoKeywordGroup;
  model: SeoWorkspaceModel;
  idea?: boolean;
}) {
  const t = useTranslations("App.Seo");
  const { pageUrl, targetPageId } = group.lead;
  const page = model.data.pages.find((item) =>
    pageUrl ? item.url === pageUrl : item.id === targetPageId,
  );
  const action = model.brief?.data?.pages.find(
    (goal) => goal.pageId === page?.id,
  )?.action;
  const reason = idea ? recommendation(group) : null;
  const url = pageUrl ?? page?.url;
  return (
    <div className="grid gap-2">
      {(reason === "both" || reason === "competition") &&
        group.difficulty !== null && (
          <p className="text-xs">
            {t("keywords.recommendation.easeEvidence", {
              value: group.difficulty,
              limit: MEDIUM_DIFFICULTY_FROM,
            })}
          </p>
        )}
      {(reason === "both" || reason === "goal") && (
        <p className="text-xs">{t("keywords.recommendation.goalEvidence")}</p>
      )}
      {url && (
        <div>
          <span className="text-xs font-medium">
            {t("keywords.recommendation.page")}
          </span>
          <SeoPageText url={url} workspace={model.data} />
        </div>
      )}
      {action && (
        <p className="text-xs">
          {t("keywords.recommendation.action", {
            action: t(`brief.actions.${action.replaceAll(" ", "_")}`),
          })}
        </p>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled
        className="h-auto min-h-8 whitespace-normal"
      >
        {t("keywords.recommendation.studio")}
      </Button>
    </div>
  );
}
