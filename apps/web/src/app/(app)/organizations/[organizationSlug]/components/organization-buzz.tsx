import { getTranslations } from "next-intl/server";
import {
  BuzzCopyField,
  BuzzPersonalAgentsSwitch,
  EnableBuzzButton,
} from "@/app/connections/components/buzz-controls";
import { BuzzLogo } from "@/components/buzz/buzz-brand";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buzzService } from "@/lib/services/buzz.service";

/**
 * The organization's Buzz community: its address and whether members bring
 * their own agents. Owners and admins change it, or put the organization on
 * Buzz; others see it.
 */
export async function OrganizationBuzz({
  organizationId,
}: {
  organizationId: string;
}) {
  const t = await getTranslations("App.Connections.Buzz");
  const connection = await buzzService.getConnection().catch(() => null);
  if (!connection?.available) return null;
  const community = connection.communities.find(
    (candidate) => candidate.organizationId === organizationId,
  );
  const canEnable = connection.canEnable.some(
    (candidate) => candidate.organizationId === organizationId,
  );
  if (!community && !canEnable) return null;

  return (
    <Card id="buzz">
      <CardHeader className="flex flex-row items-center gap-3 space-y-0">
        <BuzzLogo className="size-10 rounded-lg" />
        <div className="space-y-1">
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>
            {community ? t("organizationDescription") : t("enableDescription")}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {community ? (
          <>
            <BuzzCopyField label={t("relayUrl")} value={community.relayUrl} />
            <BuzzPersonalAgentsSwitch
              organizationId={organizationId}
              allowed={community.allowPersonalAgents}
              canManage={community.canManage}
            />
          </>
        ) : (
          <EnableBuzzButton organizationId={organizationId} />
        )}
      </CardContent>
    </Card>
  );
}
