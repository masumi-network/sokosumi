"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { useRegisterBreadcrumbOverride } from "@/contexts/breadcrumb-override-context";

interface AdsCampaignBreadcrumbProps {
  name: string;
  /** The campaigns list, which "Ads" leads to. */
  adsHref: string;
  detailsHref: string;
  /** Set on the edit page, which ends the trail with "Edit". */
  editHref?: string;
}

/**
 * Names the campaign in the header's breadcrumb. The path only holds its
 * numeric id, and `/ads/campaigns` is no page, so the trail is given whole:
 * Ads, the campaign, and "Edit" on the edit page. Renders nothing.
 */
export function AdsCampaignBreadcrumb({
  name,
  adsHref,
  detailsHref,
  editHref,
}: AdsCampaignBreadcrumbProps) {
  const t = useTranslations("Components.Breadcrumb");
  const pathname = usePathname();

  useRegisterBreadcrumbOverride({
    pathname,
    segments: [
      { label: t("ads"), href: adsHref },
      { label: name, href: detailsHref },
      ...(editHref ? [{ label: t("edit"), href: editHref }] : []),
    ],
  });

  return null;
}
