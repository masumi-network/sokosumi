import type { ProjectSeoStrategy } from "@sokosumi/core-client";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { SeoPageLink } from "./seo-shared";

const SEARCH_INTENTS = ["buyer", "informational", "other"] as const;

export function SeoStrategyPurpose({
  strategy,
}: {
  strategy: ProjectSeoStrategy;
}) {
  const t = useSeoResultTranslations("App.Seo.strategy.purpose");
  const {
    purpose,
    purposeSource,
    purposeOpportunity,
    demandByIntent,
    missingDemandByIntent,
  } = strategy;
  if (!purpose) return null;
  return (
    <section
      lang="en"
      aria-label={t("title")}
      className="space-y-3 border-b pb-3"
    >
      <p>
        <strong className="font-medium">{t(`goal.${purpose}`)}</strong>{" "}
        <span className="text-muted-foreground">
          {t(`source.${purposeSource ?? "unspecified"}`)}
        </span>
      </p>
      {purposeOpportunity && (
        <div className="space-y-1">
          <h3 className="font-medium">
            {t(`first.${purpose}`, { keyword: purposeOpportunity.keyword })}
          </h3>
          <SeoPageLink url={purposeOpportunity.pageUrl} />
          <p>
            {t("groupDemand", { count: purposeOpportunity.demand })}{" "}
            {t(purposeOpportunity.reach === "ranks" ? "ranked" : "inReach")}
          </p>
          <p>{t(`measure.${purpose}`)}</p>
        </div>
      )}
      {demandByIntent && (
        <div className="space-y-1">
          <h3 className="font-medium">{t("demand")}</h3>
          <dl className="space-y-1">
            {SEARCH_INTENTS.map((intent) => {
              const value = demandByIntent[intent];
              const missing = missingDemandByIntent?.[intent] ?? 0;
              return (
                <div
                  key={intent}
                  className="flex flex-wrap items-baseline justify-between gap-x-4"
                >
                  <dt>{t(`intents.${intent}`)}</dt>
                  <dd className="text-muted-foreground tabular-nums">
                    {missing && value === 0
                      ? t("unmeasured")
                      : missing
                        ? t("atLeast", { count: value })
                        : t("estimate", { count: value })}
                    {missing > 0 && <> · {t("missing", { count: missing })}</>}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      )}
    </section>
  );
}
