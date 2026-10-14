import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import type { SearchParams } from "nuqs/server";
import {
  CORE_RANGE_BY_PARAM,
  campaignDetailsHref,
  campaignEditHref,
  campaignsHref,
  loadCampaignDetailsSearchParams,
} from "@/app/ads/ads-query";
import { campaignLoadFailure } from "@/app/ads/campaigns/campaign-load-failure";
import { loadGoogleSetup } from "@/app/ads/campaigns/google-setup";
import { AdsCampaignBreadcrumb } from "@/app/ads/components/ads-campaign-breadcrumb";
import { GoogleCampaignForm } from "@/app/ads/components/ads-new-campaign-form";
import { PROJECTS_WORKSPACE_SHELL_CLASS } from "@/app/projects/constants";
import { googleFormValuesFromDetails } from "@/lib/ads/google-form-values";
import { adsService } from "@/lib/services/ads.service";
import { projectService } from "@/lib/services/project.service";
import { hasCurrentUserSocialBetaAccess } from "@/lib/social-beta-access.server";
import { cn } from "@/lib/utils";

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

/**
 * Edit one Google campaign, behind the same Social beta and with the same
 * 404s as its details page. A campaign Sokosumi cannot edit shows why, not the
 * form.
 */
export default async function EditAdsCampaignPage({
  params,
  searchParams,
}: EditAdsCampaignPageProps) {
  await connection();
  if (!(await hasCurrentUserSocialBetaAccess())) {
    notFound();
  }

  const { campaignId } = await params;
  const query = await loadCampaignDetailsSearchParams(searchParams);
  const projectId = query.projectId?.trim();
  const project = projectId
    ? await projectService.getProjectById(projectId)
    : null;
  if (!project) {
    notFound();
  }

  const accounts = await adsService.listAccounts(project.id);
  const account = accounts.find(({ id }) => id === query.accountId);
  if (!account || account.provider !== "google_ads") {
    notFound();
  }

  const t = await getTranslations("App.Ads.editCampaign");
  const tDetails = await getTranslations("App.Ads.campaignDetails");
  const detailsHref = campaignDetailsHref(
    project.id,
    account.id,
    campaignId,
    query.range,
  );

  let name: string | null = null;
  let body: React.ReactNode;
  try {
    // The setup never fails (a lookup that does hides its part), so it loads
    // beside the campaign instead of after it.
    const [details, google] = await Promise.all([
      adsService.getCampaignDetails(
        project.id,
        account.id,
        campaignId,
        CORE_RANGE_BY_PARAM[query.range],
      ),
      loadGoogleSetup(project.id, account.id),
    ]);
    const { campaign } = details;
    name = campaign.name;
    if (!campaign.editable) {
      body = (
        <p className="text-muted-foreground text-sm">
          {campaign.notEditableReason
            ? tDetails(`notEditable.${campaign.notEditableReason}`)
            : t("errors.conflict")}
        </p>
      );
    } else {
      const initialValues = googleFormValuesFromDetails(details);
      body = (
        <GoogleCampaignForm
          accountId={account.id}
          currency={account.currency}
          // Next keeps a visited page mounted: a campaign that changed starts a
          // new form, instead of showing the values from before the save.
          edit={{
            campaignId: campaign.id,
            detailsHref,
            started: campaign.started,
            initialValues,
          }}
          hasMarketProfile={google.hasMarketProfile}
          key={JSON.stringify([campaign.started, initialValues])}
          projectId={project.id}
          targeting={google.targeting}
        />
      );
    }
  } catch (error) {
    body = await campaignLoadFailure(error, {
      projectId: project.id,
      provider: account.provider,
    });
  }

  return (
    <div className={cn(PROJECTS_WORKSPACE_SHELL_CLASS, "pt-2 md:pt-3")}>
      <div className="flex max-w-180 flex-col gap-10 pb-16">
        {name ? (
          <AdsCampaignBreadcrumb
            adsHref={campaignsHref(project.id, account.id, query.range)}
            detailsHref={detailsHref}
            editHref={campaignEditHref(
              project.id,
              account.id,
              campaignId,
              query.range,
            )}
            name={name}
          />
        ) : null}
        <header className="flex flex-col gap-3">
          <Link
            className="text-muted-foreground hover:text-foreground self-start text-sm underline-offset-4 hover:underline"
            href={detailsHref}
          >
            {t("back")}
          </Link>
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-light tracking-tight">{t("title")}</h1>
            {name ? (
              <p className="text-muted-foreground text-sm">{name}</p>
            ) : null}
          </div>
        </header>
        {body}
      </div>
    </div>
  );
}
