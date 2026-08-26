"use client";

import { Calendar, Mail } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  connectSokoBotIntegrationAction,
  disconnectSokoBotIntegrationAction,
} from "@/lib/actions/soko-bot/action";
import type { SokoBotIntegrations } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

type Integration = SokoBotIntegrations["integrations"][number];

/** Connected accounts used for read-only mail and calendar access. */
export function IntegrationsSection({
  initial,
}: {
  initial: SokoBotIntegrations;
}) {
  const t = useTranslations("App.SokoBot.Integrations");
  const format = useFormatter();
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function connect(provider: string) {
    setBusy(provider);
    startTransition(async () => {
      const result = await connectSokoBotIntegrationAction({ provider });
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

  if (!initial.configured) {
    return <p className="text-muted-foreground text-sm">{t("unavailable")}</p>;
  }

  return (
    <ul className="divide-y rounded-md border">
      {initial.integrations.map((integration) => (
        <li
          key={integration.provider}
          className="flex items-center gap-3 px-3 py-3"
        >
          <span className="bg-muted text-muted-foreground inline-flex size-8 shrink-0 items-center justify-center rounded-md">
            {integration.kinds.includes("email") ? (
              <Mail aria-hidden className="size-4" />
            ) : (
              <Calendar aria-hidden className="size-4" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">
                {integration.name}
              </span>
              <StatusDot status={integration.status} />
            </span>
            <span className="text-muted-foreground block truncate text-xs">
              {describe(integration, t, format)}
            </span>
          </span>
          {integration.status === "ACTIVE" ||
          integration.status === "PENDING" ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy === integration.provider || !integration.available}
              onClick={() => disconnect(integration.provider)}
            >
              {t("disconnect")}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy === integration.provider || !integration.available}
              onClick={() => connect(integration.provider)}
            >
              {integration.status === "DISCONNECTED"
                ? t("connect")
                : t("reconnect")}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function describe(
  integration: Integration,
  t: ReturnType<typeof useTranslations<"App.SokoBot.Integrations">>,
  format: ReturnType<typeof useFormatter>,
): string {
  if (!integration.available && integration.status === "DISCONNECTED") {
    return t("providerUnavailable");
  }
  switch (integration.status) {
    case "ACTIVE":
      return integration.lastIngestAt
        ? t("lastChecked", {
            when: format.relativeTime(new Date(integration.lastIngestAt)),
          })
        : t("connectedNotChecked");
    case "PENDING":
      return t("pending");
    case "FAILED":
    case "REVOKED":
      return integration.lastError ?? t("failed");
    default:
      return integration.kinds.includes("email")
        ? integration.kinds.includes("calendar")
          ? t("kindsMailCalendar")
          : t("kindsMail")
        : t("kindsCalendar");
  }
}

function StatusDot({ status }: { status: Integration["status"] }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        status === "ACTIVE" && "bg-semantic-success",
        status === "PENDING" && "bg-semantic-warning",
        (status === "FAILED" || status === "REVOKED") &&
          "bg-semantic-destructive",
        status === "DISCONNECTED" && "bg-border",
      )}
    />
  );
}
