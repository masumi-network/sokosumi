import { getTranslations } from "next-intl/server";
import { CoreAuthReadRetry } from "@/components/auth/core-auth-read-retry";
import { teamStandupService } from "@/lib/services/team-standup.service";
import { TeamStandupForm } from "./team-standup-form";

export async function TeamStandupSettings({
  organizationId,
  canEdit,
}: {
  organizationId: string;
  canEdit: boolean;
}) {
  const t = await getTranslations("App.TeamStandup");
  try {
    const standup = await teamStandupService.get(organizationId);
    return (
      <TeamStandupForm
        organizationId={organizationId}
        initial={standup}
        canEdit={canEdit}
      />
    );
  } catch (error) {
    console.error("Failed to load the stand-up settings", error);
    return (
      <CoreAuthReadRetry
        title={t("title")}
        description={t("loadError")}
        retryLabel={t("retry")}
      />
    );
  }
}
