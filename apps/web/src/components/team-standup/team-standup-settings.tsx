import { getTranslations } from "next-intl/server";
import { CoreAuthReadRetry } from "@/components/auth/core-auth-read-retry";
import { getSession } from "@/lib/auth/auth.server";
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
    const [standup, session] = await Promise.all([
      teamStandupService.get(organizationId),
      getSession({ refresh: true }),
    ]);
    return (
      <TeamStandupForm
        organizationId={organizationId}
        initial={standup}
        canEdit={canEdit}
        includeMyWeek={session?.user.hideWeekFromStandup !== true}
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
