"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { ProjectScopeRequired } from "@/app/components/project-scope/project-scope-required";
import { useProjectScope } from "@/app/components/project-scope/use-project-scope";

const NEED_PROJECT_COPY = {
  accounts: "accountsNeedProject",
  attention: "attentionNeedProject",
  drafts: "draftsNeedProject",
} as const;

interface SocialAccountsProjectPromptProps {
  kind?: keyof typeof NEED_PROJECT_COPY;
  notice?: string;
  /**
   * Open the header's project selector on arrival. Off where the prompt sits
   * above a view that works without a project, as the calendar does.
   */
  autoOpen?: boolean;
}

/**
 * Project-owned accounts and drafts ask for a project through the header's
 * own selector, as Content Studio does.
 */
export function SocialAccountsProjectPrompt({
  kind = "accounts",
  notice,
  autoOpen = true,
}: SocialAccountsProjectPromptProps) {
  const copy = NEED_PROJECT_COPY[kind];
  const t = useTranslations("App.Social");
  const router = useRouter();
  const { switchHref } = useProjectScope();

  return (
    <ProjectScopeRequired
      action={t("pickProject")}
      autoOpen={autoOpen}
      body={notice ?? t(`${copy}.body`)}
      onSelect={(nextProjectId) => {
        // Scope switching resets page filters. Keep the tab that asked for a project.
        router.push(`${switchHref(nextProjectId)}&tab=${kind}`);
      }}
      testId="social-no-project"
      title={t(`${copy}.title`)}
    />
  );
}
