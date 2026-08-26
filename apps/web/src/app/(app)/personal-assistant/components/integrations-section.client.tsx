"use client";

import { Calendar, Mail, Plug, Search } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  connectSokoBotIntegrationAction,
  disconnectSokoBotIntegrationAction,
  searchSokoBotIntegrationCatalogAction,
} from "@/lib/actions/soko-bot/action";
import type {
  SokoBotIntegrationCatalogEntry,
  SokoBotIntegrations,
} from "@/lib/clients/generated/core";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";

type Integration = SokoBotIntegrations["integrations"][number];

/**
 * Connected accounts (Gmail, Outlook, Google Calendar). Connect sends the
 * owner through Composio's OAuth and back to the return page.
 */
export function IntegrationsSection({
  initial,
}: {
  initial: SokoBotIntegrations;
}) {
  const t = useTranslations("App.SokoBot.Integrations");
  const format = useFormatter();
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    SokoBotIntegrationCatalogEntry[] | null
  >(null);
  const [searching, setSearching] = useState(false);

  function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearching(true);
    startTransition(async () => {
      const result = await searchSokoBotIntegrationCatalogAction({ query });
      setSearching(false);
      if (!result.ok) {
        toast.error(result.error.message ?? t("searchError"));
        return;
      }
      const connected = new Set(
        initial.integrations
          .filter((i) => i.status !== "DISCONNECTED")
          .map((i) => i.provider),
      );
      setResults(
        result.value.filter((entry) => !connected.has(entry.provider)),
      );
    });
  }

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

  if (!initial.configured) {
    return <p className="text-muted-foreground text-sm">{t("unavailable")}</p>;
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-md border">
        {initial.integrations.map((integration) => (
          <li
            key={integration.provider}
            className="flex items-center gap-3 px-3 py-3"
          >
            <span className="bg-muted text-muted-foreground inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md">
              {integration.logoUrl ? (
                <img
                  src={integration.logoUrl}
                  alt=""
                  className="size-5 object-contain"
                />
              ) : integration.kinds.includes("email") ? (
                <Mail aria-hidden className="size-4" />
              ) : integration.kinds.includes("calendar") ? (
                <Calendar aria-hidden className="size-4" />
              ) : (
                <Plug aria-hidden className="size-4" />
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
                disabled={busy === integration.provider}
                onClick={() => disconnect(integration.provider)}
              >
                {t("disconnect")}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy === integration.provider}
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
      <form onSubmit={search} className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
        />
        <Button type="submit" size="sm" variant="outline" disabled={searching}>
          <Search aria-hidden className="size-3.5" />
          {t("search")}
        </Button>
      </form>
      {results ? (
        results.length === 0 ? (
          <p className="text-muted-foreground text-xs">{t("noResults")}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {results.map((entry) => (
              <li
                key={entry.provider}
                className="flex items-center gap-3 px-3 py-2"
              >
                {entry.logoUrl ? (
                  <img
                    src={entry.logoUrl}
                    alt=""
                    className="size-6 shrink-0 rounded object-contain"
                  />
                ) : (
                  <span className="bg-muted text-muted-foreground inline-flex size-6 shrink-0 items-center justify-center rounded">
                    <Plug aria-hidden className="size-3.5" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {entry.name}
                  </span>
                  {entry.description ? (
                    <span className="text-muted-foreground block truncate text-xs">
                      {entry.description}
                    </span>
                  ) : null}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy === entry.provider}
                  onClick={() => connect(entry.provider)}
                >
                  {t("connect")}
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

function describe(
  integration: Integration,
  t: ReturnType<typeof useTranslations<"App.SokoBot.Integrations">>,
  format: ReturnType<typeof useFormatter>,
): string {
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
        : integration.kinds.includes("calendar")
          ? t("kindsCalendar")
          : t("kindsGeneric");
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
