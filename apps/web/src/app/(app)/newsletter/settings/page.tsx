import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import type { SearchParams } from "nuqs/server";

import { newsletterService } from "@/lib/services/newsletter.service";

import { NewsletterPageShell } from "../components/newsletter-page-shell";
import {
  loadNewsletterProject,
  newsletterWorkspacePage,
} from "../newsletter-project";
import { NewsletterSettingsForm } from "../newsletter-settings-form";
import { getNewsletterTabs } from "../newsletter-tabs";
import { SendingDomainCard } from "../sending-domain-card";

export const instant = false;

interface NewsletterSettingsPageProps {
  searchParams: Promise<SearchParams>;
}

export { generateNewsletterMetadata as generateMetadata } from "@/app/newsletter/newsletter-project";

/**
 * The newsletter's Settings tab, where a project's newsletter is created.
 *
 * It reads its project from `?projectId=`, so the sidebar's project switcher
 * moves it between projects. With no project it lists the projects.
 */
export default async function NewsletterSettingsPage({
  searchParams,
}: NewsletterSettingsPageProps) {
  await connection();
  if (!(await newsletterService.isEnabled())) notFound();

  const scope = await loadNewsletterProject(searchParams);
  if (!scope.project) {
    return newsletterWorkspacePage({ unavailable: scope.unavailable });
  }
  const { project } = scope;

  const [newsletter, sendingDomain, page, t] = await Promise.all([
    newsletterService.getSettings(project.id),
    newsletterService.getSendingDomain(project.id),
    getTranslations("App.Newsletter"),
    getTranslations("App.Projects.Newsletter"),
  ]);
  // CMO sets up a CMO Project's newsletter; existing settings stay readable.

  return (
    <NewsletterPageShell
      cmoProjectId={project.cmo ? project.id : undefined}
      navigationLabel={t("navigation")}
      tabs={getNewsletterTabs(project.id, !!newsletter, t, project.cmo)}
      title={page("title")}
    >
      {!project.cmo || newsletter ? (
        <NewsletterSettingsForm
          key={newsletter?.id ?? project.id}
          newsletter={newsletter}
          projectId={project.id}
          projectName={project.name}
          projectLogo={project.logo}
          readOnly={project.cmo}
          sendingDomain={
            <SendingDomainCard
              state={
                project.cmo
                  ? { ...sendingDomain, canManage: false }
                  : sendingDomain
              }
              projectId={project.id}
            />
          }
        />
      ) : null}
    </NewsletterPageShell>
  );
}
