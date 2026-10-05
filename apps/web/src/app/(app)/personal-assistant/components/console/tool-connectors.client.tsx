"use client";

import type {
  SokoBotIntegrationCatalogEntry,
  SokoBotIntegrations,
} from "@sokosumi/core-client";
import { ChevronDown } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
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
import { cn } from "@/lib/utils";
import {
  describeIntegration,
  needsReconnect,
  type SokoBotIntegration,
  useIntegrationActions,
} from "../use-integration-actions";

/** Popular apps shown after mail and calendar; the rest live under Advanced. */
const POPULAR_SHOWN = 6;
/** A phone stacks one per row, so it shows fewer. */
const POPULAR_SHOWN_ON_PHONE = 3;

interface Connector {
  provider: string;
  name: string;
  logoUrl: string | null;
  caption: string;
  integration: SokoBotIntegration | null;
  hiddenOnPhone: boolean;
}

/**
 * The apps the assistant can use, each with its connection state and one
 * action: Connect, Reconnect, or Manage once it works.
 */
export function ToolConnectors({
  integrations,
  catalog,
  onBrowseAll,
}: {
  integrations: SokoBotIntegrations;
  catalog: SokoBotIntegrationCatalogEntry[];
  onBrowseAll: () => void;
}) {
  const t = useTranslations("App.SokoBot.Integrations");
  const format = useFormatter();
  const { busy, connect, disconnect } = useIntegrationActions();

  if (!integrations.configured) {
    return <p className="text-muted-foreground text-sm">{t("unavailable")}</p>;
  }

  const listed = new Set(integrations.integrations.map((i) => i.provider));
  const connectors: Connector[] = [
    ...integrations.integrations.map((integration) => ({
      provider: integration.provider,
      name: integration.name,
      logoUrl: integration.logoUrl,
      caption: describeIntegration(integration, t, format),
      integration,
      hiddenOnPhone: false,
    })),
    ...catalog
      .filter((entry) => !listed.has(entry.provider))
      .slice(0, POPULAR_SHOWN)
      .map((entry, index) => ({
        provider: entry.provider,
        name: entry.name,
        logoUrl: entry.logoUrl,
        caption: entry.description ?? t("kindsGeneric"),
        integration: null,
        hiddenOnPhone: index >= POPULAR_SHOWN_ON_PHONE,
      })),
  ];

  return (
    <div className="space-y-3">
      <ul
        className={cn(HOLDER_CLASS, "grid gap-2 sm:grid-cols-2 xl:grid-cols-3")}
      >
        {connectors.map((connector) => (
          <li
            key={connector.provider}
            className={cn(
              HOLDER_ITEM_CLASS,
              "flex items-center gap-3 p-3",
              connector.hiddenOnPhone && "max-sm:hidden",
            )}
          >
            <ProviderMark
              provider={connector.provider}
              name={connector.name}
              logoUrl={connector.logoUrl}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{connector.name}</p>
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
        ))}
      </ul>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={onBrowseAll}
      >
        {t("browseAll")}
      </Button>
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
