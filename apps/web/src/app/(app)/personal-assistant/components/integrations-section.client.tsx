"use client";

import { Search } from "lucide-react";
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
const GRID_INITIAL = 8;

export function IntegrationsSection({
  initial,
  catalog,
}: {
  initial: SokoBotIntegrations;
  /** Popular toolkits, already sorted by usage; empty when the catalog is unavailable. */
  catalog: SokoBotIntegrationCatalogEntry[];
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
  const [expanded, setExpanded] = useState(false);
  const connectedIds = new Set(
    initial.integrations
      .filter((i) => i.status !== "DISCONNECTED")
      .map((i) => i.provider),
  );
  const featuredIds = new Set(initial.integrations.map((i) => i.provider));
  const browsable = catalog.filter(
    (entry) =>
      !connectedIds.has(entry.provider) && !featuredIds.has(entry.provider),
  );
  const shown = results ?? browsable.slice(0, expanded ? 24 : GRID_INITIAL);

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
    <div className="space-y-4">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {initial.integrations.map((integration) => (
          <li key={integration.provider}>
            <Tile
              name={integration.name}
              logoUrl={integration.logoUrl}
              caption={describe(integration, t, format)}
              status={integration.status}
              hasError={Boolean(integration.lastErrorAt)}
              busy={busy === integration.provider}
              actionLabel={
                integration.lastErrorAt
                  ? t("reconnect")
                  : integration.status === "ACTIVE"
                    ? t("disconnect")
                    : integration.status === "DISCONNECTED"
                      ? t("connect")
                      : t("reconnect")
              }
              onAction={() =>
                integration.status === "ACTIVE" && !integration.lastErrorAt
                  ? disconnect(integration.provider)
                  : connect(integration.provider)
              }
            />
          </li>
        ))}
      </ul>

      {shown.length === 0 ? (
        results ? (
          <p className="text-muted-foreground text-xs">{t("noResults")}</p>
        ) : null
      ) : (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs">
            {results ? t("resultsTitle") : t("popularTitle")}
          </p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {shown.map((entry) => (
              <li key={entry.provider}>
                <Tile
                  name={entry.name}
                  logoUrl={entry.logoUrl}
                  caption={entry.description}
                  status="DISCONNECTED"
                  busy={busy === entry.provider}
                  actionLabel={t("connect")}
                  onAction={() => connect(entry.provider)}
                />
              </li>
            ))}
          </ul>
          {!results && browsable.length > GRID_INITIAL ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded
                ? t("showFewer")
                : t("showMore", { count: browsable.length })}
            </Button>
          ) : null}
        </div>
      )}
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
    </div>
  );
}

/** One app: logo, name, one-line state, and its action on hover/focus. */
function Tile({
  name,
  logoUrl,
  caption,
  status,
  hasError = false,
  busy,
  actionLabel,
  onAction,
}: {
  name: string;
  logoUrl: string | null;
  caption: string | null;
  status: Integration["status"];
  hasError?: boolean;
  busy: boolean;
  actionLabel: string;
  onAction: () => void;
}) {
  const active = status === "ACTIVE";
  const broken = status === "FAILED" || status === "REVOKED" || hasError;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onAction}
      title={caption ?? name}
      className={cn(
        "group focus-visible:ring-ring relative flex h-full w-full flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-center transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60",
        broken
          ? "border-semantic-destructive/40 bg-semantic-destructive/5 hover:bg-semantic-destructive/10"
          : active
            ? "border-primary/30 bg-primary/5 hover:bg-primary/10"
            : "hover:border-primary/40 hover:bg-primary/5",
      )}
    >
      <StatusDot
        status={broken ? "FAILED" : status}
        className="absolute top-2 right-2"
      />
      {logoUrl ? (
        <img src={logoUrl} alt="" className="size-8 rounded object-contain" />
      ) : (
        <span className="bg-primary/10 text-primary inline-flex size-8 items-center justify-center rounded text-sm font-medium">
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="w-full truncate text-xs font-medium">{name}</span>
      <span className="text-muted-foreground line-clamp-1 w-full text-[0.6875rem] group-hover:hidden group-focus-visible:hidden">
        {caption ?? "\u00a0"}
      </span>
      <span className="text-primary hidden w-full truncate text-[0.6875rem] group-hover:block group-focus-visible:block">
        {actionLabel}
      </span>
    </button>
  );
}

function describe(
  integration: Integration,
  t: ReturnType<typeof useTranslations<"App.SokoBot.Integrations">>,
  format: ReturnType<typeof useFormatter>,
): string {
  switch (integration.status) {
    case "ACTIVE":
      if (integration.lastErrorAt && integration.lastError) {
        return t("lastError", { error: integration.lastError.slice(0, 80) });
      }
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

function StatusDot({
  status,
  className,
}: {
  status: Integration["status"];
  className?: string;
}) {
  if (status === "DISCONNECTED") return null;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        className,
        status === "ACTIVE" && "bg-semantic-success",
        status === "PENDING" && "bg-semantic-warning",
        (status === "FAILED" || status === "REVOKED") &&
          "bg-semantic-destructive",
      )}
    />
  );
}
