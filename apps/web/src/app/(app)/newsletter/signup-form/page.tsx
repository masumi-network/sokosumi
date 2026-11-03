import { newsletterSignupLinks } from "@sokosumi/utils";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import type { SearchParams } from "nuqs/server";

import { NewsletterPageShell } from "@/app/newsletter/components/newsletter-page-shell";
import {
  loadNewsletterProject,
  newsletterWorkspacePage,
} from "@/app/newsletter/newsletter-project";
import { NewsletterSignupCard } from "@/app/newsletter/newsletter-signup-card";
import {
  getNewsletterTabs,
  newsletterHref,
} from "@/app/newsletter/newsletter-tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { getEnvPublicConfig } from "@/config/env.public";
import { newsletterService } from "@/lib/services/newsletter.service";
import { cn } from "@/lib/utils";

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

  const [page, t] = await Promise.all([
    getTranslations("App.Newsletter"),
    getTranslations("App.Projects.Newsletter"),
  ]);
  const { signupUrl } = newsletterSignupLinks(
    newsletter.publicSlug,
    getEnvPublicConfig().NEXT_PUBLIC_SOKOSUMI_URL,
    t("SignupForm.embedTitle"),
  );

  return (
    <NewsletterPageShell
      description={t("SignupForm.pageDescription")}
      heading={page("projectTitle", { project: project.name })}
      navigationLabel={t("navigation")}
      tabs={getNewsletterTabs(project.id, true, t)}
      title={page("title")}
    >
      <div
        className={cn(HOLDER_CLASS, "grid items-start gap-2 lg:grid-cols-2")}
      >
        <NewsletterSignupCard publicSlug={newsletter.publicSlug} />
        <section
          aria-labelledby="newsletter-signup-preview"
          className="min-w-0"
        >
          <Card>
            <CardHeader>
              <CardTitle>
                <h3 id="newsletter-signup-preview">
                  {t("SignupForm.previewTitle")}
                </h3>
              </CardTitle>
              <CardDescription>
                {t("SignupForm.previewDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <iframe
                className="h-110 w-full rounded-md border bg-background"
                src={`${signupUrl}/embed`}
                title={t("SignupForm.previewTitle")}
                loading="lazy"
              />
            </CardContent>
          </Card>
        </section>
      </div>
    </NewsletterPageShell>
  );
}
