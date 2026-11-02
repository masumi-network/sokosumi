"use client";

import type {
  SokoBotIntegrationCatalogEntry,
  SokoBotIntegrations,
} from "@sokosumi/core-client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDown, Search } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
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

interface Connector {
  provider: string;
  name: string;
  logoUrl: string | null;
  caption: string;
  integration: SokoBotIntegration | null;
  hiddenOnPhone: boolean;
}

/** Composio's apps for a search; the empty search is the most used ones. */
function useCatalog(query: string) {
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);
  return useQuery({
    queryKey: ["soko-bot-integration-catalog", debounced.trim()],
    queryFn: async (): Promise<SokoBotIntegrationCatalogEntry[]> => {
      const result = await searchSokoBotIntegrationCatalogAction({
        query: debounced.trim(),
      });
      return result.ok ? result.value : [];
    },
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}

/**
 * The apps the assistant can use, each with its connection state and one
 * action: Connect, Reconnect, or Manage once it works. The search reaches
 * every app Composio connects in one click; `focusProvider` (from a bot's
 * connect link) opens with that app searched and marked.
 */
export function ToolConnectors({
  integrations,
  focusProvider = null,
}: {
  integrations: SokoBotIntegrations;
  focusProvider?: string | null;
}) {
  const t = useTranslations("App.SokoBot.Integrations");
  const format = useFormatter();
  const { busy, connect, disconnect } = useIntegrationActions();
  const [query, setQuery] = useState(focusProvider ?? "");
  const catalog = useCatalog(query);
  const focused = useRef<HTMLLIElement>(null);
  const searching = query.trim().length > 0;

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
        ? describeIntegration(integration, t, format)
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
          caption: describeIntegration(integration, t, format),
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
      <div className="relative">
        <Search
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className="ps-9"
        />
      </div>
      {searching && catalog.data?.length === 0 && !catalog.isFetching ? (
        <p className="text-muted-foreground px-1 text-sm">{t("noResults")}</p>
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
                <ConnectorAction
                  connector={connector}
                  busy={busy === connector.provider}
                  onConnect={() => connect(connector.provider)}
                  onDisconnect={() => disconnect(connector.provider)}
                />
              </li>
            );
          })}
        </ul>
      )}
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
