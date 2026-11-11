import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import type { SearchParams } from "nuqs/server";

import { NewsletterPageShell } from "@/app/newsletter/components/newsletter-page-shell";
import {
  loadNewsletterProject,
  newsletterWorkspacePage,
} from "@/app/newsletter/newsletter-project";
import {
  getNewsletterTabs,
  newsletterHref,
} from "@/app/newsletter/newsletter-tabs";
import { ClientMessageBoundary } from "@/i18n/client-message-boundary";
import { PUBLIC_NEWSLETTER_MESSAGE_PATHS } from "@/i18n/message-namespaces";
import { newsletterService } from "@/lib/services/newsletter.service";
import { NewsletterSignupDesigner } from "./signup-form-designer";

export const instant = false;

interface NewsletterSignupFormPageProps {
  searchParams: Promise<SearchParams>;
}

export default async function NewsletterSignupFormPage({
  searchParams,
}: NewsletterSignupFormPageProps) {
  await connection();
  if (!(await newsletterService.isEnabled())) notFound();

  const scope = await loadNewsletterProject(searchParams);
  if (!scope.project) {
    return newsletterWorkspacePage({ unavailable: scope.unavailable });
  }
  const { project } = scope;
  const newsletter = await newsletterService.getSettings(project.id);
  if (!newsletter) redirect(newsletterHref("/newsletter/settings", project.id));
  // CMO designs a CMO Project's signup form; its saved preview stays readable.

  const [page, t] = await Promise.all([
    getTranslations("App.Newsletter"),
    getTranslations("App.Projects.Newsletter"),
  ]);

  return (
    <NewsletterPageShell
      cmoProjectId={project.cmo ? project.id : undefined}
      navigationLabel={t("navigation")}
      tabs={getNewsletterTabs(project.id, true, t, project.cmo)}
      title={page("title")}
    >
      <ClientMessageBoundary
        paths={[...PUBLIC_NEWSLETTER_MESSAGE_PATHS, "App.Projects.Newsletter"]}
      >
        <NewsletterSignupDesigner
          newsletter={newsletter}
          projectId={project.id}
          readOnly={project.cmo}
        />
      </ClientMessageBoundary>
    </NewsletterPageShell>
  );
}
