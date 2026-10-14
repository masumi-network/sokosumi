import type { AdCampaignDetails } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";

import type { RangeParam } from "@/app/ads/ads-query";
import {
  APPROVAL_STATUSES,
  enumLabel,
  problemApproval,
} from "@/lib/ads/campaign-details";
import { formatGoogleKeyword } from "@/lib/ads/google-keywords";

import { AdsCampaignActions } from "./ads-campaign-actions";
import { AdsCampaignAd } from "./ads-campaign-ad";
import { AdsCampaignPerformance } from "./ads-campaign-performance";
import { AdsFact, AdsFactList, AdsFacts } from "./ads-fact";
import { AdsFormSection } from "./ads-form-section";
import { adsDay, adsFormat } from "./ads-format";

const BIDDING_STRATEGIES = ["TARGET_SPEND"] as const;

interface AdsCampaignDetailsProps {
  accountId: string;
  details: AdCampaignDetails;
  projectId: string;
  range: RangeParam;
}

/**
 * One Google campaign, read-only, rendered on the server: what it is, how it
 * performed, how it is set up and what it shows. Only the performance block
 * and the menu are client code.
 */
export function AdsCampaignDetails({
  accountId,
  details,
  projectId,
  range,
}: AdsCampaignDetailsProps) {
  const t = useTranslations("App.Ads.campaignDetails");
  const tCampaigns = useTranslations("App.Ads.campaigns");
  const tNew = useTranslations("App.Ads.newCampaign");
  const formatter = useFormatter();

  const { campaign, targeting, keywords, ad, sitelinks, callouts } = details;
  const { money } = adsFormat(formatter, campaign.currency);
  const date = (value: string) => adsDay(formatter, value, { year: true });
  const approval = (status: string | null) => {
    const problem = problemApproval(status);
    return problem
      ? enumLabel(problem, APPROVAL_STATUSES, (key) => t(`approval.${key}`))
      : null;
  };

  const dates = (() => {
    if (campaign.startDate && campaign.endDate) {
      return t("dates.range", {
        start: date(campaign.startDate),
        end: date(campaign.endDate),
      });
    }
    if (campaign.startDate) {
      return t("dates.from", { start: date(campaign.startDate) });
    }
    return campaign.endDate
      ? t("dates.until", { end: date(campaign.endDate) })
      : null;
  })();
  const facts = [
    t(`types.${campaign.type}`),
    tCampaigns(`status.${campaign.status}`),
    t("perDay", { amount: money(campaign.dailyBudget) }),
    dates,
  ].filter((fact) => fact !== null);

  return (
    <div className="flex flex-col gap-10">
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-3xl font-light tracking-tight text-balance">
            {campaign.name}
          </h1>
          <p className="text-muted-foreground text-sm">{facts.join(" · ")}</p>
        </div>
        <AdsCampaignActions
          accountId={accountId}
          campaign={campaign}
          currency={campaign.currency}
          projectId={projectId}
          provider="google_ads"
        />
      </header>

      <AdsCampaignPerformance
        currency={campaign.currency}
        performance={details.performance}
        range={range}
      />

      <AdsFormSection id="campaign-settings" title={t("sections.settings")}>
        <AdsFacts className="sm:grid-cols-2">
          <AdsFact label={t("settings.type")}>
            {t(`types.${campaign.type}`)}
          </AdsFact>
          <AdsFact label={t("settings.bidding")}>
            {enumLabel(
              campaign.biddingStrategyType,
              BIDDING_STRATEGIES,
              (key) => t(`bidding.${key}`),
            )}
          </AdsFact>
          <AdsFact label={tNew("startDate")}>
            {campaign.startDate ? date(campaign.startDate) : "—"}
          </AdsFact>
          <AdsFact label={tNew("endDate")}>
            {campaign.endDate ? date(campaign.endDate) : t("noEndDate")}
          </AdsFact>
          <AdsFact label={tCampaigns("columns.dailyBudget")}>
            {money(campaign.dailyBudget)}
          </AdsFact>
        </AdsFacts>
      </AdsFormSection>

      <AdsFormSection id="campaign-targeting" title={t("sections.targeting")}>
        <AdsFacts>
          <AdsFact label={tNew("targeting.locations.label")}>
            {targeting.locations.length > 0 ? (
              <AdsFactList
                items={targeting.locations.map(
                  ({ canonicalName, name }) => canonicalName || name,
                )}
              />
            ) : (
              tNew("targeting.locations.all")
            )}
          </AdsFact>
          <AdsFact label={tNew("targeting.languages.label")}>
            {targeting.languages.length > 0
              ? targeting.languages.map(({ name }) => name).join(", ")
              : tNew("targeting.languages.all")}
          </AdsFact>
        </AdsFacts>
      </AdsFormSection>

      {campaign.type === "SEARCH" ? (
        <AdsFormSection id="campaign-keywords" title={t("sections.keywords")}>
          <ul className="flex flex-col gap-2">
            {keywords.map((keyword) => (
              <li
                key={keyword.id}
                className="flex items-baseline justify-between gap-4 text-sm"
              >
                <span className="min-w-0 break-words">
                  {formatGoogleKeyword(keyword)}
                </span>
                <span className="text-muted-foreground shrink-0">
                  {[
                    t(`matchTypes.${keyword.matchType}`),
                    approval(keyword.approvalStatus),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </AdsFormSection>
      ) : null}

      {ad ? (
        <AdsCampaignAd ad={ad} />
      ) : (
        <p className="text-muted-foreground text-sm">{t("notEditable")}</p>
      )}

      {sitelinks.length > 0 ? (
        <AdsFormSection id="campaign-sitelinks" title={t("sections.sitelinks")}>
          <ul className="flex flex-col gap-4">
            {sitelinks.map((sitelink) => (
              <li key={sitelink.assetId} className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{sitelink.text}</span>
                <span className="text-muted-foreground text-sm break-all">
                  {sitelink.finalUrl}
                </span>
                {[
                  sitelink.description1,
                  sitelink.description2,
                  approval(sitelink.approvalStatus),
                ]
                  .filter(Boolean)
                  .map((line) => (
                    <span key={line} className="text-muted-foreground text-sm">
                      {line}
                    </span>
                  ))}
              </li>
            ))}
          </ul>
        </AdsFormSection>
      ) : null}

      {callouts.length > 0 ? (
        <AdsFormSection id="campaign-callouts" title={t("sections.callouts")}>
          <ul className="flex flex-col gap-2">
            {callouts.map((callout) => (
              <li
                key={callout.assetId}
                className="flex items-baseline justify-between gap-4 text-sm"
              >
                <span>{callout.text}</span>
                <span className="text-muted-foreground">
                  {approval(callout.approvalStatus)}
                </span>
              </li>
            ))}
          </ul>
        </AdsFormSection>
      ) : null}
    </div>
  );
}
