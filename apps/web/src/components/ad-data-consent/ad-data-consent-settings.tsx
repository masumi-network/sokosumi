import { getTranslations } from "next-intl/server";
import { CoreAuthReadRetry } from "@/components/auth/core-auth-read-retry";
import { isOrganizationOwnerOrAdmin } from "@/lib/helpers/organization-member";
import { adDataConsentService } from "@/lib/services/ad-data-consent.service";
import { userService } from "@/lib/services/user.service";
import { AdDataConsentForm } from "./ad-data-consent-form";

interface AdDataConsentSettingsProps {
  organizationId: string | null;
}

export async function AdDataConsentSettings({
  organizationId,
}: AdDataConsentSettingsProps) {
  const t = await getTranslations("App.AdDataConsent");
  try {
    const workspaces = await userService.getMyWorkspaces();
    const workspace = workspaces?.workspaces.find((row) =>
      organizationId
        ? row.organizationId === organizationId
        : row.kind === "personal",
    );
    if (!workspace) return null;
    const consent = await adDataConsentService.get(workspace.id);
    return (
      <AdDataConsentForm
        key={workspace.id}
        workspaceId={workspace.id}
        shareForImprovement={consent.shareForImprovement}
        allowTraining={consent.allowTraining}
        canEdit={
          workspace.kind === "personal" ||
          isOrganizationOwnerOrAdmin(workspace.role ?? "")
        }
      />
    );
  } catch (error) {
    console.error("Failed to load ad data consent", error);
    return (
      <CoreAuthReadRetry
        title={t("title")}
        description={t("loadError")}
        retryLabel={t("retry")}
      />
    );
  }
}
