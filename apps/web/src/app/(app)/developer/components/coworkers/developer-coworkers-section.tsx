import { getTranslations } from "next-intl/server";

import { developerCoworkerService } from "@/lib/services/developer-coworker.service";

import { DeveloperCoworkersList } from "./developer-coworkers-list";

export async function DeveloperCoworkersSection() {
  const t = await getTranslations("App.Developer.Coworkers");

  try {
    const coworkers = await developerCoworkerService.listOwnedCoworkers();

    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>
        <DeveloperCoworkersList coworkers={coworkers} />
      </div>
    );
  } catch {
    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>
        <p className="text-destructive text-sm">{t("loadFailed")}</p>
      </div>
    );
  }
}
