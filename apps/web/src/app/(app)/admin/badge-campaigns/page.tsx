import type { BadgeCampaign } from "@sokosumi/core-client";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import {
  type AnnouncedFeatureLabels,
  BadgeCampaignForm,
} from "@/components/admin/badge-campaigns/badge-campaign-form";
import {
  type BadgeCampaignRow,
  type BadgeCampaignStatus,
  BadgeCampaignsTable,
} from "@/components/admin/badge-campaigns/badge-campaigns-table";
import { coreClient } from "@/lib/clients/core.client";

export const metadata: Metadata = {
  title: "Feature badges",
  description: "Announce sidebar features with a time-boxed New badge",
};

function campaignStatus(
  campaign: BadgeCampaign,
  now: Date,
): BadgeCampaignStatus {
  if (campaign.startsAt > now) {
    return "scheduled";
  }
  return campaign.endsAt > now ? "live" : "ended";
}

/**
 * The names straight from the sidebar's own strings, so the list always reads
 * as the sidebar does (DRIVE is "Files"). A feature Core adds without a label
 * here fails the typecheck.
 */
async function getAnnouncedFeatureLabels(): Promise<AnnouncedFeatureLabels> {
  const menu = await getTranslations("App.Sidebar.Content.MenuItems");
  const unread = await getTranslations("App.Channels.UnreadNav");
  return {
    SOKO_BOTS: menu("sokoBot"),
    NEW_TASK: menu("newTask"),
    SEARCH: menu("search"),
    AGENTS: menu("exploreAgents"),
    TASKS: menu("taskManager"),
    SCHEDULES: menu("schedules"),
    CONTENT_STUDIO: menu("contentStudio"),
    SOCIAL: menu("social"),
    DRIVE: menu("drive"),
    THREADS: unread("threads"),
    UNREADS: unread("allUnreads"),
  };
}

export default async function AdminBadgeCampaignsPage() {
  const t = await getTranslations("App.Admin.BadgeCampaigns");
  const featureLabels = await getAnnouncedFeatureLabels();

  let rows: BadgeCampaignRow[] | null = null;
  try {
    const now = new Date();
    const campaigns = await coreClient.listAdminBadgeCampaigns();
    rows = campaigns.map((campaign) => ({
      campaign,
      status: campaignStatus(campaign, now),
    }));
  } catch {
    rows = null;
  }

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>

        <section className="space-y-3 rounded-lg border p-4">
          <h2 className="text-base font-semibold">{t("Form.createTitle")}</h2>
          <BadgeCampaignForm featureLabels={featureLabels} />
        </section>

        {rows ? (
          <BadgeCampaignsTable rows={rows} featureLabels={featureLabels} />
        ) : (
          <p className="text-destructive text-sm">{t("loadFailed")}</p>
        )}
      </div>
    </div>
  );
}
