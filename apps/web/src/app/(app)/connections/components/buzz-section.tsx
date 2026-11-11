import type { BuzzConnection } from "@sokosumi/core-client";
import { getTranslations } from "next-intl/server";

import { Card } from "@/components/ui/card";
import { buzzService } from "@/lib/services/buzz.service";

import {
  BuzzAppLink,
  BuzzCopyField,
  BuzzSecretKey,
  EnableBuzzButton,
} from "./buzz-controls";

/**
 * Buzz: chat from a Buzz client in the same rooms. Each organization on Buzz
 * is a community at its own address; the person signs in with their key.
 */
export async function BuzzSection() {
  const t = await getTranslations("App.Connections.Buzz");
  let connection: BuzzConnection;
  try {
    connection = await buzzService.getConnection();
  } catch {
    return null;
  }
  if (
    !connection.available ||
    (connection.communities.length === 0 && connection.canEnable.length === 0)
  ) {
    return null;
  }

  return (
    <section className="space-y-3" data-testid="connections-buzz">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {connection.identity && (
          <Card className="space-y-4 p-4">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">{t("appTitle")}</h3>
              <p className="text-muted-foreground text-xs">
                {t("appDescription")}
              </p>
            </div>
            <BuzzAppLink
              app={connection.app}
              sokosumiPubkey={connection.identity.pubkey}
            />
          </Card>
        )}
        {connection.identity && (
          <Card className="space-y-4 p-4">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">{t("identityTitle")}</h3>
              <p className="text-muted-foreground text-xs">
                {t("identityDescription")}
              </p>
            </div>
            <BuzzCopyField
              label={t("publicKey")}
              value={connection.identity.npub}
            />
            <BuzzSecretKey />
          </Card>
        )}
        {connection.communities.map((community) => (
          <Card key={community.organizationId} className="space-y-4 p-4">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">
                {community.organizationName}
              </h3>
              <p className="text-muted-foreground text-xs">
                {t("communityDescription")}
              </p>
            </div>
            <BuzzCopyField label={t("relayUrl")} value={community.relayUrl} />
          </Card>
        ))}
        {connection.canEnable.map((organization) => (
          <Card
            key={organization.organizationId}
            className="flex flex-wrap items-center justify-between gap-3 p-4"
          >
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">
                {organization.organizationName}
              </h3>
              <p className="text-muted-foreground text-xs">
                {t("enableDescription")}
              </p>
            </div>
            <EnableBuzzButton organizationId={organization.organizationId} />
          </Card>
        ))}
      </div>
    </section>
  );
}
