"use client";

import type {
  SokoBotIntegrationCatalogEntry,
  SokoBotIntegrations,
} from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2, Search } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { LoadErrorState } from "@/components/common/load-error-state";
import { SOKO_BOT_PROVIDER_LOGOS } from "@/components/soko-bot/provider-logos";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { searchSokoBotIntegrationCatalogAction } from "@/lib/actions/soko-bot/action";
import { cn } from "@/lib/utils";
import {
  describeIntegration,
  needsReconnect,
  type SokoBotIntegration,
  useIntegrationActions,
} from "../use-integration-actions";

/** Popular apps shown after mail and calendar until someone searches. */
const POPULAR_SHOWN = 6;
/** A phone stacks one per row, so it shows fewer. */
const POPULAR_SHOWN_ON_PHONE = 3;
const SEARCH_DELAY_MS = 250;
/** `searchSokoBotIntegrationCatalogAction` refuses a longer search. */
const SEARCH_MAX_LENGTH = 100;

interface Connector {
  provider: string;
  name: string;
  logoUrl: string | null;
  caption: string;
  integration: SokoBotIntegration | null;
  hiddenOnPhone: boolean;
}

/**
 * Composio's apps for a search; the empty search is the most used ones. Each
 * search keeps its own answer, so a slow one never lands on a newer search.
 * `phase` is about what is typed now: an older or stale answer never stands
 * in for it, and a failed search stays failed while Try again runs.
 */
function useCatalog(query: string, enabled: boolean) {
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);
  const catalog = useQuery({
    queryKey: ["soko-bot-integration-catalog", debounced.trim()],
    queryFn: async (): Promise<SokoBotIntegrationCatalogEntry[]> => {
      const result = await searchSokoBotIntegrationCatalogAction({
        query: debounced.trim(),
      });
      // A failed search is not an empty one; Try again is the retry.
      if (!result.ok) throw new Error("Catalog search failed");
      return result.value;
    },
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });
  // Running or paused offline: either way no answer is in yet.
  const inFlight = catalog.fetchStatus !== "idle";
  // A retry with no answer yet puts the query back to pending; its last
  // outcome is still the failure.
  const failed =
    catalog.isError ||
    (inFlight && catalog.errorUpdatedAt > catalog.dataUpdatedAt);
  const phase: "searching" | "failed" | "done" =
    query.trim() !== debounced.trim()
      ? "searching"
      : failed
        ? "failed"
        : inFlight
          ? "searching"
          : "done";
  return { ...catalog, inFlight, phase };
}

/**
 * The apps the assistant can use, each with its connection state and one
 * action: Connect, Reconnect, or Manage once it works. The search reaches
 * every app Composio connects in one click; `focusProvider` (from a bot's
 * connect link) opens with that app searched and marked. `readOnly` (Cuso,
 * ADR 0066) lists only the bot's own apps, with no search or action.
 */
export function ToolConnectors({
  integrations,
  focusProvider = null,
  readOnly = false,
}: {
  integrations: SokoBotIntegrations;
  focusProvider?: string | null;
  readOnly?: boolean;
}) {
  const t = useTranslations("App.SokoBot.Integrations");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const { busy, connect, disconnect } = useIntegrationActions();
  // A connect link's search obeys the same limit as a typed one.
  const [query, setQuery] = useState(() =>
    (focusProvider ?? "").slice(0, SEARCH_MAX_LENGTH),
  );
  const catalog = useCatalog(query, !readOnly);
  const focused = useRef<HTMLLIElement>(null);
  // A connect link never searches on a read-only bot.
  const searching = !readOnly && query.trim().length > 0;

  useEffect(() => {
    if (focusProvider && catalog.data)
      focused.current?.scrollIntoView({ block: "center" });
  }, [focusProvider, catalog.data]);

  if (!integrations.configured) {
    return <p className="text-muted-foreground text-sm">{t("unavailable")}</p>;
  }

  const byProvider = new Map(
    integrations.integrations.map((integration) => [
      integration.provider,
      integration,
    ]),
  );
  const fromCatalog = (
    entry: SokoBotIntegrationCatalogEntry,
    index: number,
  ): Connector => {
    const integration = byProvider.get(entry.provider) ?? null;
    return {
      provider: entry.provider,
      name: integration?.name ?? entry.name,
      logoUrl: integration?.logoUrl ?? entry.logoUrl,
      caption: integration
        ? describeIntegration(integration, t, format, now)
        : (entry.description ?? t("kindsGeneric")),
      integration,
      hiddenOnPhone: !searching && index >= POPULAR_SHOWN_ON_PHONE,
    };
  };
  const connectors: Connector[] = searching
    ? (catalog.data ?? []).map(fromCatalog)
    : [
        ...integrations.integrations.map((integration) => ({
          provider: integration.provider,
          name: integration.name,
          logoUrl: integration.logoUrl,
          caption: describeIntegration(integration, t, format, now),
          integration,
          hiddenOnPhone: false,
        })),
        ...(catalog.data ?? [])
          .filter((entry) => !byProvider.has(entry.provider))
          .slice(0, POPULAR_SHOWN)
          .map(fromCatalog),
      ];

  return (
    <div className="space-y-3">
      {readOnly ? null : (
        <div className="relative">
          <Search
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
          />
          <Input
            type="search"
            maxLength={SEARCH_MAX_LENGTH}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="ps-9"
          />
        </div>
      )}
      {searching && (catalog.phase !== "done" || !catalog.data?.length) ? (
        <SearchOutcome query={query.trim()} catalog={catalog} />
      ) : (
        <ul
          className={cn(
            HOLDER_CLASS,
            "grid gap-2 sm:grid-cols-2 xl:grid-cols-3",
          )}
          aria-busy={catalog.isFetching}
        >
          {connectors.map((connector) => {
            const isFocus = connector.provider === focusProvider;
            return (
              <li
                key={connector.provider}
                ref={isFocus ? focused : undefined}
                className={cn(
                  HOLDER_ITEM_CLASS,
                  "flex items-center gap-3 p-3",
                  connector.hiddenOnPhone && "max-sm:hidden",
                  isFocus && "border-foreground",
                )}
              >
                <ProviderMark
                  provider={connector.provider}
                  name={connector.name}
                  logoUrl={connector.logoUrl}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {connector.name}
                  </p>
                  <p
                    className="text-muted-foreground line-clamp-2 text-xs text-pretty"
                    title={connector.caption}
                  >
                    <StateDot integration={connector.integration} />
                    {connector.caption}
                  </p>
                </div>
                {readOnly ? null : (
                  <ConnectorAction
                    connector={connector}
                    busy={busy === connector.provider}
                    onConnect={() => connect(connector.provider)}
                    onDisconnect={() => disconnect(connector.provider)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** A search with no apps to list: still running, failed, or found none. */
function SearchOutcome({
  query,
  catalog,
}: {
  query: string;
  catalog: ReturnType<typeof useCatalog>;
}) {
  const t = useTranslations("App.SokoBot.Integrations");
  if (catalog.phase === "searching") return <SearchPlaceholder query={query} />;
  if (catalog.phase === "failed")
    return (
      <LoadErrorState
        data-testid="app-search-error"
        description={t("searchFailedHelp")}
        retrying={catalog.inFlight}
        retryLabel={t("tryAgain")}
        title={t("searchFailed")}
        variant="banner"
        // Try again stays mounted and busy while it runs, and through another
        // failure. Results replace it without moving focus on purpose: the
        // browser drops focus to the page and the next Tab continues from
        // where the button was, which never pulls a user who moved on back.
        onRetry={() => void catalog.refetch()}
      />
    );
  return (
    <p className="text-muted-foreground px-1 text-sm" role="status">
      {t("noResults")}
    </p>
  );
}

/** The search for `query` is running: cards the size of the answer's. */
function SearchPlaceholder({ query }: { query: string }) {
  const t = useTranslations("App.SokoBot.Integrations");
  return (
    <div className="space-y-3">
      <p
        className="text-muted-foreground flex items-center gap-2 px-1 text-sm"
        role="status"
      >
        <Loader2
          aria-hidden
          className="size-4 animate-spin motion-reduce:animate-none"
        />
        <span className="min-w-0 truncate">{t("searching", { query })}</span>
      </p>
      <ul
        aria-hidden
        className={cn(HOLDER_CLASS, "grid gap-2 sm:grid-cols-2 xl:grid-cols-3")}
      >
        {Array.from({ length: POPULAR_SHOWN }, (_, index) => (
          <li
            key={index}
            data-testid="connector-placeholder"
            className={cn(
              HOLDER_ITEM_CLASS,
              "flex items-center gap-3 p-3",
              index >= POPULAR_SHOWN_ON_PHONE && "max-sm:hidden",
            )}
          >
            <Skeleton className="size-9 shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3 w-40 max-w-full" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConnectorAction({
  connector,
  busy,
  onConnect,
  onDisconnect,
}: {
  connector: Connector;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const t = useTranslations("App.SokoBot.Integrations");
  const integration = connector.integration;
  const status = integration?.status ?? "DISCONNECTED";

  if (status === "DISCONNECTED") {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={onConnect}
        aria-label={`${t("connect")} ${connector.name}`}
      >
        {t("connect")}
      </Button>
    );
  }
  if (status === "PENDING" || (integration && needsReconnect(integration))) {
    return (
      <Button
        type="button"
        size="sm"
        disabled={busy}
        onClick={onConnect}
        aria-label={`${t("reconnect")} ${connector.name}`}
      >
        {t("reconnect")}
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          aria-label={`${t("manage")} ${connector.name}`}
        >
          {t("manage")}
          <ChevronDown aria-hidden className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onConnect}>
          {t("reconnect")}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={onDisconnect}>
          {t("disconnect")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The brand mark: our own SVG where we have one, else Composio's logo. */
function ProviderMark({
  provider,
  name,
  logoUrl,
}: {
  provider: string;
  name: string;
  logoUrl: string | null;
}) {
  const Logo = SOKO_BOT_PROVIDER_LOGOS[provider];
  return (
    // A light chip in both themes: many marks (GitHub, Notion) are black.
    <span className="bg-background dark:bg-foreground flex size-9 shrink-0 items-center justify-center rounded-md border dark:border-transparent">
      {Logo ? (
        <Logo className="size-5" />
      ) : logoUrl ? (
        <img src={logoUrl} alt="" className="size-5 object-contain" />
      ) : (
        <span className="text-muted-foreground text-sm font-medium">
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}

function StateDot({ integration }: { integration: SokoBotIntegration | null }) {
  if (!integration || integration.status === "DISCONNECTED") return null;
  const broken = needsReconnect(integration);
  return (
    <span
      aria-hidden
      className={cn(
        "mr-1.5 mb-px inline-block size-1.5 rounded-full align-middle",
        broken
          ? "bg-semantic-destructive"
          : integration.status === "PENDING"
            ? "bg-semantic-warning"
            : "bg-semantic-success",
      )}
    />
  );
}
