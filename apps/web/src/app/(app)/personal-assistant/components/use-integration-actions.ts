import type { SokoBotIntegrations } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  connectSokoBotIntegrationAction,
  disconnectSokoBotIntegrationAction,
} from "@/lib/actions/soko-bot/action";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";

export type SokoBotIntegration = SokoBotIntegrations["integrations"][number];

/** Connect sends the owner through Composio's OAuth and back to the return page. */
export function useIntegrationActions() {
  const t = useTranslations("App.SokoBot.Integrations");
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function connect(provider: string) {
    setBusy(provider);
    startTransition(async () => {
      const returnUrl = `${window.location.origin}${SOKO_BOT_ROUTE}/integrations/return?provider=${encodeURIComponent(provider)}`;
      const result = await connectSokoBotIntegrationAction({
        provider,
        returnUrl,
      });
      if (!result.ok) {
        setBusy(null);
        toast.error(result.error.message ?? t("connectError"));
        return;
      }
      window.location.assign(result.value.redirectUrl);
    });
  }

  function disconnect(provider: string) {
    setBusy(provider);
    startTransition(async () => {
      const result = await disconnectSokoBotIntegrationAction({ provider });
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error.message ?? t("disconnectError"));
        return;
      }
      toast.success(t("disconnected"));
    });
  }

  return { busy, connect, disconnect };
}

/** Whether the connection needs the owner to sign in again. */
export function needsReconnect(integration: SokoBotIntegration): boolean {
  return (
    integration.status === "FAILED" ||
    integration.status === "REVOKED" ||
    Boolean(integration.lastErrorAt)
  );
}

export function describeIntegration(
  integration: SokoBotIntegration,
  t: ReturnType<typeof useTranslations<"App.SokoBot.Integrations">>,
  format: ReturnType<typeof useFormatter>,
): string {
  const readsMail = integration.kinds.includes("email");
  const readsCalendar = integration.kinds.includes("calendar");
  switch (integration.status) {
    case "ACTIVE":
      if (integration.lastErrorAt && integration.lastError) {
        return t("lastError", { error: integration.lastError.slice(0, 80) });
      }
      // A calendar is read when a briefing or meeting needs it, not polled.
      if (readsCalendar && !readsMail) {
        return integration.lastIngestAt
          ? t("lastRead", {
              when: format.relativeTime(new Date(integration.lastIngestAt)),
            })
          : t("connectedNotRead");
      }
      return integration.lastIngestAt
        ? t("lastChecked", {
            when: format.relativeTime(new Date(integration.lastIngestAt)),
          })
        : readsMail
          ? t("connectedNotChecked")
          : t("connectedTools");
    case "PENDING":
      return t("pending");
    case "FAILED":
    case "REVOKED":
      return integration.lastError ?? t("failed");
    default:
      return readsMail
        ? readsCalendar
          ? t("kindsMailCalendar")
          : t("kindsMail")
        : readsCalendar
          ? t("kindsCalendar")
          : t("kindsGeneric");
  }
}
