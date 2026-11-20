import { useLocale, useTranslations } from "next-intl";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { cn } from "@/lib/utils";
import { SeoDate, SeoFoldSummary, SeoPageLink, SeoSection } from "./seo-shared";
import {
  SEO_STRATEGY_VERDICTS,
  seoStrategyKey,
  seoStrategyReason,
} from "./seo-strategy-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoStrategicPlanning({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const result = useSeoResultTranslations("App.Seo");
  const locale = useLocale();
  const strategy = model.data.strategy;
  const priorities =
    model.brief?.data?.priorities?.filter(
      (p) =>
        model.data.scope.pageIds.includes(p.pageId) &&
        (!model.filters.pageId || p.pageId === model.filters.pageId),
    ) ?? [];
  const verdict =
    strategy && seoStrategyKey(SEO_STRATEGY_VERDICTS, strategy.verdict);
  const lead = strategy && seoStrategyReason(strategy).lead;
  const rationale = strategy?.why.slice(lead?.length ?? 0).trim();
  if (!strategy && !priorities.length) return null;
  return (
    <SeoSection title={t("planning.title")}>
      <div className={cn(HOLDER_ITEM_CLASS, "space-y-5 p-4 sm:p-6")}>
        {strategy && (
          <div className="max-w-prose space-y-2" lang="en">
            <p className="text-xs text-muted-foreground">
              <SeoDate day report value={strategy.observedAt} />
            </p>
            <h3 className="text-base font-semibold">
              {verdict
                ? result(`strategy.verdict.${verdict}`)
                : strategy.verdict}
            </h3>
            <p className="text-sm">{lead}</p>
            {rationale && (
              <details>
                <SeoFoldSummary className="min-h-9 text-sm">
                  <span lang={locale}>{t("brief.why")}</span>
                </SeoFoldSummary>
                <p className="pt-2 text-sm text-muted-foreground">
                  {rationale}
                </p>
              </details>
            )}
          </div>
        )}
        {priorities.length > 0 ? (
          <section aria-label={t("brief.priority")}>
            <h3 className="text-sm font-semibold">{t("brief.priority")}</h3>
            <ol className="mt-3 divide-y">
              {priorities.map((p) => {
                const page = model.data.pages.find(
                  (item) => item.id === p.pageId,
                );
                return (
                  <li key={p.pageId} className="space-y-2 py-3 first:pt-0">
                    <h4 className="text-xs font-medium text-muted-foreground">
                      {t("brief.nextStep")}
                    </h4>
                    <p lang="en" className="text-sm font-medium">
                      {p.nextStep}
                    </p>
                    {page && <SeoPageLink url={page.url} label={page.label} />}
                    {p.why.length > 0 && (
                      <ul
                        lang="en"
                        className="space-y-1 text-sm text-muted-foreground"
                      >
                        {p.why.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        ) : (
          strategy?.actions[0] && (
            <div className="space-y-1 border-t pt-4">
              <h4 className="text-xs font-medium text-muted-foreground">
                {t("brief.nextStep")}
              </h4>
              <p lang="en" className="text-sm">
                {strategy.actions[0].title}
              </p>
              {strategy.actions[0].expectedEffect && (
                <p lang="en" className="text-sm text-muted-foreground">
                  {strategy.actions[0].expectedEffect}
                </p>
              )}
            </div>
          )
        )}
        {!!strategy?.placesNotes?.length && (
          <details>
            <SeoFoldSummary className="min-h-9 text-sm">
              {t("strategy.places.title")}
            </SeoFoldSummary>
            <ul
              data-testid="seo-strategy-place-notes"
              lang="en"
              className="space-y-2 py-2 text-sm"
            >
              {strategy.placesNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </SeoSection>
  );
}
