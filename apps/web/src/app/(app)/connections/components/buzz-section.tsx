import type { BuzzConnection } from "@sokosumi/core-client";
import { getTranslations } from "next-intl/server";
import { BuzzAgentCard } from "@/components/buzz/buzz-agent-card";
import { BuzzLogo } from "@/components/buzz/buzz-brand";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buzzService } from "@/lib/services/buzz.service";

import {
  BuzzConnectButton,
  BuzzCopyField,
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

  const actions = connection.identity ? (
    <div className="flex items-center gap-2">
      {/* One button in one place: linking happens mid-dialog, and the
          dialog must outlive that. */}
      <BuzzConnectButton
        variant={
          linked && !authorized ? "primary" : connected ? "outline" : "primary"
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
  ) : null;

  return (
    <Card data-testid="connections-buzz">
      <CardHeader className="flex flex-wrap items-center gap-4">
        <BuzzLogo className="size-10 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <CardTitle>
            <h2>{t("title")}</h2>
          </CardTitle>
          <CardDescription>{t("description")}</CardDescription>
          {connection.identity ? (
            <p className="text-foreground flex items-center gap-1.5 text-xs font-medium">
              <span
                aria-hidden
                className={
                  connected
                    ? "bg-status-success size-1.5 rounded-full"
                    : "bg-presence-offline size-1.5 rounded-full"
                }
              />
              {status}
            </p>
          ) : null}
        </div>
        {actions}
      </CardHeader>
      <CardContent className="space-y-6">
        {identityNpub ? (
          <BuzzCopyField
            label={t("identityTitle")}
            value={identityNpub}
            hint={t("identityHint")}
            copyLabel={t("copyIdentity")}
          />
        ) : null}
        {connected ? (
          <section className="space-y-3">
            <h3 className="text-muted-foreground text-xs font-medium">
              {t("agentsTitle")}
            </h3>
            {connection.agents.length > 0 ? (
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
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
          </section>
        ) : null}
        {connection.communities.length + connection.canEnable.length > 0 ? (
          <section className="space-y-3">
            <h3 className="text-muted-foreground text-xs font-medium">
              {t("communitiesTitle")}
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              {connection.communities.map((community) => (
                <div
                  key={community.organizationId}
                  className="space-y-3 rounded-lg border p-3"
                >
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">
                      {community.organizationName}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {t("communityDescription")}
                    </p>
                  </div>
                  <BuzzCopyField
                    label={t("relayUrl")}
                    value={community.relayUrl}
                  />
                </div>
              ))}
              {connection.canEnable.map((organization) => (
                <div
                  key={organization.organizationId}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium">
                      {organization.organizationName}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {t("enableDescription")}
                    </p>
                  </div>
                  <EnableBuzzButton
                    organizationId={organization.organizationId}
                  />
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
