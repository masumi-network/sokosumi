import type { ProjectTab } from "@/app/projects/components/project-tabs";

export function getNewsletterTabs(
  projectId: string,
  hasNewsletter: boolean,
  t: IntlTranslation<"App.Projects.Newsletter">,
): ProjectTab[] {
  const tabs: ProjectTab[] = [
    {
      id: "settings",
      href: `/projects/${projectId}/newsletter`,
      label: t("settings"),
      exact: true,
    },
  ];
  if (hasNewsletter)
    tabs.push({
      id: "subscribers",
      href: `/projects/${projectId}/newsletter/subscribers`,
      label: t("Subscribers.title"),
    });
  return tabs;
}
