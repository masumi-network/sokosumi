import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { createLoader, parseAsString, type SearchParams } from "nuqs/server";

import { PROJECTS_PAGE_LIMIT } from "@/app/projects/constants";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { newsletterService } from "@/lib/services/newsletter.service";
import { projectService } from "@/lib/services/project.service";
import { isUuidString } from "@/lib/utils/uuid";

export const instant = false;

const loadSearchParams = createLoader({
  projectId: parseAsString,
  cursor: parseAsString,
});

interface NewsletterPageProps {
  searchParams: Promise<SearchParams>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Newsletter");
  return { title: t("title") };
}

export default async function NewsletterPage({
  searchParams,
}: NewsletterPageProps) {
  await connection();
  if (!(await newsletterService.isEnabled())) notFound();

  const query = await loadSearchParams(searchParams);
  const projectId = query.projectId?.trim();
  if (projectId) {
    if (!isUuidString(projectId)) notFound();
    const project = await projectService.getProjectById(projectId);
    if (!project) notFound();
    redirect(`/projects/${encodeURIComponent(project.id)}/newsletter`);
  }

  const [{ projects, pagination }, t] = await Promise.all([
    projectService.listProjects({
      limit: PROJECTS_PAGE_LIMIT,
      cursor: query.cursor ?? undefined,
    }),
    getTranslations("App.Newsletter"),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 py-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </header>
      {projects.length ? (
        <ul className="space-y-2">
          {projects.map((project) => (
            <li key={project.id}>
              <Button
                asChild
                variant="outline"
                className="h-auto min-h-11 w-full justify-start whitespace-normal text-start"
              >
                <Link
                  href={`/projects/${encodeURIComponent(project.id)}/newsletter`}
                >
                  <span className="min-w-0 break-words">{project.name}</span>
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title={t("empty.title")}
          description={t("empty.description")}
          action={
            <Button asChild>
              <Link href="/projects?create=true">{t("empty.action")}</Link>
            </Button>
          }
        />
      )}
      {pagination?.nextCursor ? (
        <Button asChild variant="outline">
          <Link
            href={`/newsletter?cursor=${encodeURIComponent(pagination.nextCursor)}`}
          >
            {t("nextPage")}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
