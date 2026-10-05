"use client";

import { useTranslations } from "next-intl";
/**
 * Social accounts, on the all-projects view.
 *
 * Accounts are connected per project, so there is nothing to connect for the
 * workspace as a whole. The sidebar switcher selects the project.
 */
export function SocialAccountsProjectPrompt({
  kind = "accounts",
  notice,
}: {
  /** Accounts and drafts both belong to one project; say which one is waiting. */
  kind?: "accounts" | "drafts";
  notice?: string;
}) {
  const copy = kind === "drafts" ? "draftsNeedProject" : "accountsNeedProject";
  const t = useTranslations("App.Social");

  return (
    <section
      aria-labelledby="social-accounts-heading"
      className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
      data-testid="social-no-project"
    >
      <div className="space-y-1">
        <h2 id="social-accounts-heading" className="text-base font-semibold">
          {t(`${copy}.title`)}
        </h2>
        <p className="text-muted-foreground text-sm">
          {notice ?? t(`${copy}.body`)}
        </p>
      </div>
    </section>
  );
}
