import type { BuzzConnection } from "@sokosumi/core-client";
import { getTranslations } from "next-intl/server";
import { BuzzAgentCard } from "@/components/buzz/buzz-agent-card";
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

  const linked = connection.app !== null;
  const authorized = connection.app?.authorized === true;
  const connected = linked || connection.lastActiveOnBuzzAt !== null;
  const identityNpub = connection.app?.npub ?? connection.identity?.npub;
  const status = linked
    ? authorized
      ? t("statusLinked")
      : t("statusUnauthorized")
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
              {/* One button in one place: linking happens mid-dialog, and
                  the dialog must outlive that. */}
              <div className="flex items-center gap-2">
                <BuzzConnectButton
                  variant={
                    linked && !authorized
                      ? "primary"
                      : connected
                        ? "outline"
                        : "primary"
                  }
                  label={
                    linked && !authorized
                      ? t("authorize")
                      : connected
                        ? t("connectAgain")
                        : t("connect")
                  }
                  resume={linked}
                />
                {linked ? <BuzzUnlinkButton /> : null}
              </div>
            </div>
            {identityNpub ? (
              <div className="border-t pt-4">
                <BuzzCopyField
                  label={t("identityTitle")}
                  value={identityNpub}
                  hint={t("identityHint")}
                  copyLabel={t("copyIdentity")}
                />
              </div>
            ) : null}
            {connected ? (
              <div className="space-y-3 border-t pt-4">
                <p className="text-muted-foreground text-xs font-medium">
                  {t("agentsTitle")}
                </p>
                {connection.agents.length > 0 ? (
                  <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {connection.agents.map((agent, index) => (
                      <li key={agent.npub}>
                        <BuzzAgentCard
                          name={agent.name}
                          image={agent.image}
                          npub={agent.npub}
                          index={index}
                          personalLabel={t("personalAgent")}
                          copyLabel={t("copyAgentKey", { name: agent.name })}
                          copiedLabel={t("copied")}
                        />
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
