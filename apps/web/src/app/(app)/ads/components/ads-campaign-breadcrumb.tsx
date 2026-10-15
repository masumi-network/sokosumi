"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { useRegisterBreadcrumbOverride } from "@/contexts/breadcrumb-override-context";

interface AdsCampaignBreadcrumbProps {
  /** The campaigns list, which "Ads" leads to. */
  adsHref: string;
  /** The campaign, once its name is known. */
  campaign?: { name: string; href: string };
  /** The page after the campaign, or after Ads for a new campaign. */
  page?: { label: "new" | "edit"; href: string };
}

/**
 * Gives an ads campaign page its whole breadcrumb trail. The path alone has
 * no project: `/ads/campaigns` is no page and the path's links lose the
 * `projectId` query, so Ads, the campaign (named, not its numeric id) and
 * the page each carry their own href. Renders nothing.
 */
export function AdsCampaignBreadcrumb({
  adsHref,
  campaign,
  page,
}: AdsCampaignBreadcrumbProps) {
  const t = useTranslations("Components.Breadcrumb");
  const pathname = usePathname();

  useRegisterBreadcrumbOverride({
    pathname,
    segments: [
      { label: t("ads"), href: adsHref },
      ...(campaign ? [{ label: campaign.name, href: campaign.href }] : []),
      ...(page ? [{ label: t(page.label), href: page.href }] : []),
    ],
  });

  return null;
}
