import type { Metadata } from "next";
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

export const instant = false;

interface NewsletterSettingsPageProps {
  searchParams: Promise<SearchParams>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Newsletter");
  return { title: t("title") };
}

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
    return newsletterWorkspacePage({
      path: "/newsletter/settings",
      searchParams,
      unavailable: scope.unavailable,
    });
  }
  const { project } = scope;

  const [newsletter, page, t] = await Promise.all([
    newsletterService.getSettings(project.id),
    getTranslations("App.Newsletter"),
    getTranslations("App.Projects.Newsletter"),
  ]);

  return (
    <NewsletterPageShell
      description={t("description")}
      heading={page("projectTitle", { project: project.name })}
      navigationLabel={t("navigation")}
      tabs={getNewsletterTabs(project.id, !!newsletter, t)}
      title={page("title")}
    >
      <NewsletterSettingsForm
        key={newsletter?.id ?? project.id}
        newsletter={newsletter}
        projectId={project.id}
        projectName={project.name}
        projectLogo={project.logo}
      />
    </NewsletterPageShell>
  );
}
