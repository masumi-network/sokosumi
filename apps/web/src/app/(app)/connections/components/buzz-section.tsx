import type { BuzzConnection } from "@sokosumi/core-client";
import { getTranslations } from "next-intl/server";
import { BuzzLogo } from "@/components/buzz/buzz-brand";
import { Card } from "@/components/ui/card";
import { buzzService } from "@/lib/services/buzz.service";

import {
  BuzzConnectButton,
  BuzzCopyField,
  BuzzPersonalAgentsSwitch,
  BuzzUnlinkButton,
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

  const linked = connection.app?.status === "linked";
  const connected = linked || connection.lastActiveOnBuzzAt !== null;
  const status = linked
    ? t("statusLinked", { npub: `${connection.app?.npub.slice(0, 16)}…` })
    : connection.lastActiveOnBuzzAt
      ? t("statusConnected")
      : t("statusNotConnected");

  return (
    <section className="space-y-3" data-testid="connections-buzz">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {connection.identity && (
          <Card className="flex flex-col gap-4 p-4 md:col-span-2">
            <div className="flex flex-wrap items-center gap-4">
              <BuzzLogo className="size-12 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-1">
                <h3 className="text-sm font-semibold">{t("statusTitle")}</h3>
                <p className="text-muted-foreground text-sm">{status}</p>
              </div>
              {connection.app?.status === "linked" ? (
                <BuzzUnlinkButton />
              ) : (
                <BuzzConnectButton
                  variant={connected ? "outline" : "primary"}
                  label={connected ? t("connectAgain") : t("connect")}
                />
              )}
            </div>
            {connected ? (
              <div className="space-y-1 border-t pt-3">
                <p className="text-muted-foreground text-xs font-medium">
                  {t("agentsTitle")}
                </p>
                {connection.agents.length > 0 ? (
                  <ul className="flex flex-wrap gap-2">
                    {connection.agents.map((agent) => (
                      <li
                        key={agent.npub}
                        className="bg-muted rounded-md px-2 py-1 text-sm"
                      >
                        {agent.name}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="text-muted-foreground text-xs">
                  {connection.agents.length > 0
                    ? t("agentsHint")
                    : t("agentsEmpty")}
                </p>
              </div>
            ) : null}
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
            <BuzzPersonalAgentsSwitch
              organizationId={community.organizationId}
              allowed={community.allowPersonalAgents}
              canManage={community.canManage}
            />
          </Card>
        ))}
        {connection.canEnable.map((organization) => (
          <Card
            key={organization.organizationId}
            className="flex flex-col items-start justify-between gap-4 p-4"
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
