import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import type { SearchParams } from "nuqs/server";

import { newsletterService } from "@/lib/services/newsletter.service";

import {
  loadNewsletterProject,
  newsletterWorkspacePage,
} from "./newsletter-project";
import { newsletterHref } from "./newsletter-tabs";

export const instant = false;

interface NewsletterPageProps {
  searchParams: Promise<SearchParams>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Newsletter");
  return { title: t("title") };
}

/**
 * Newsletter, as a top-level destination like Social.
 *
 * It reads its project from `?projectId=`, so the sidebar's project switcher
 * moves it between projects. Like Social opening on its calendar, it opens
 * the newsletter's issues, or Settings to create a newsletter the project does
 * not have yet. With no project it lists the projects.
 */
export default async function NewsletterPage({
  searchParams,
}: NewsletterPageProps) {
  await connection();
  if (!(await newsletterService.isEnabled())) notFound();

  const scope = await loadNewsletterProject(searchParams);
  if (!scope.project) {
    return newsletterWorkspacePage({
      path: "/newsletter",
      searchParams,
      unavailable: scope.unavailable,
    });
  }
  const { id } = scope.project;
  const newsletter = await newsletterService.getSettings(id);
  redirect(
    newsletterHref(
      newsletter ? "/newsletter/issues" : "/newsletter/settings",
      id,
    ),
  );
}
