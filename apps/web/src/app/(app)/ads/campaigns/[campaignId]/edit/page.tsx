import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { SearchParams } from "nuqs/server";

import { AdsCampaignEdit } from "@/app/ads/campaigns/campaign-edit";

// Wait for the current session and project access before rendering.
export const instant = false;

interface EditAdsCampaignPageProps {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<SearchParams>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Ads.editCampaign");
  return { title: t("title") };
}

/** A direct link to a campaign's edit: the edit modal on its own, with the page's breadcrumb. */
export default async function EditAdsCampaignPage(
  props: EditAdsCampaignPageProps,
) {
  return AdsCampaignEdit({ ...props, breadcrumb: true });
}
