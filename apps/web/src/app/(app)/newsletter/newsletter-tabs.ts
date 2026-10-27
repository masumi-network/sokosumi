import { PROJECT_SCOPE_PARAM } from "@/app/components/project-scope/project-scope-href";
import type { ProjectTab } from "@/app/projects/components/project-tabs";

/** A newsletter route for one project, which it reads from `?projectId=`. */
export function newsletterHref(path: string, projectId: string): string {
  return `${path}?${new URLSearchParams({ [PROJECT_SCOPE_PARAM]: projectId })}`;
}

/**
 * The newsletter section's tabs, in one place so a new section (a Calendar
 * tab, say) is added here. Until the newsletter exists only Settings, where
 * it is created, is there.
 */
export function getNewsletterTabs(
  projectId: string,
  hasNewsletter: boolean,
  t: IntlTranslation<"App.Projects.Newsletter">,
): ProjectTab[] {
  const settings: ProjectTab = {
    id: "settings",
    href: newsletterHref("/newsletter/settings", projectId),
    label: t("settings"),
  };
  if (!hasNewsletter) return [settings];
  return [
    {
      id: "issues",
      href: newsletterHref("/newsletter/issues", projectId),
      label: t("Issues.title"),
    },
    {
      id: "subscribers",
      href: newsletterHref("/newsletter/subscribers", projectId),
      label: t("Subscribers.title"),
    },
    settings,
  ];
}
