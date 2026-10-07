import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";

import { ProjectScopePicker } from "@/app/components/project-scope/project-scope-picker";
import { projectService } from "@/lib/services/project.service";
import { hasCurrentUserSocialBetaAccess } from "@/lib/social-beta-access.server";

import { AdsPageShell } from "./components/ads-page-shell";
import { AdsTabs } from "./components/ads-tabs";

// Wait for the current session and project access before rendering.
export const instant = false;

interface AdsPageProps {
  searchParams: Promise<{ projectId?: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Ads");
  return { title: t("title") };
}

/**
 * Ads, as a top-level destination behind the Social beta.
 *
 * Ad accounts belong to one project, so the page reads `?projectId=` like
 * Social and the studio do, and with no project it asks for one.
 */
export default async function AdsPage({ searchParams }: AdsPageProps) {
  await connection();
  if (!(await hasCurrentUserSocialBetaAccess())) {
    notFound();
  }

  const query = await searchParams;
  const t = await getTranslations("App.Ads");
  const projectId = query.projectId?.trim();
  const project = projectId
    ? await projectService.getProjectById(projectId)
    : null;

  if (!project) {
    return (
      <AdsPageShell title={t("title")}>
        <ProjectScopePicker
          action={t("pickAction")}
          // Not `notFound()` for a lost id: it came from a switchable scope,
          // so the repair is to pick another project.
          body={projectId ? t("pickUnavailable") : t("pickBody")}
          testId="ads-no-project"
          title={t("pickTitle")}
        />
      </AdsPageShell>
    );
  }

  return (
    <AdsPageShell title={t("title")}>
      <AdsTabs />
    </AdsPageShell>
  );
}
