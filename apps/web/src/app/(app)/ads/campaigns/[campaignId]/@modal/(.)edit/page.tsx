import type { SearchParams } from "nuqs/server";

import { AdsCampaignEdit } from "@/app/ads/campaigns/campaign-edit";

export { generateMetadata } from "@/app/ads/campaigns/[campaignId]/edit/page";

// Wait for the current session and project access before rendering.
export const instant = false;

/** Edit opened from the details page: the same modal, over the details. */
export default async function AdsCampaignEditModalPage(props: {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  return AdsCampaignEdit(props);
}
