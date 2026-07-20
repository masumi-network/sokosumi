"use client";

import { Blocks, Settings as SettingsIcon, Zap } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type {
  HermesIntegrationProvider,
  HermesIntegrationPublic,
} from "./types";

const INTEGRATION_ICON_BY_PROVIDER: Record<HermesIntegrationProvider, string> =
  {
    gmail: "/icons/gmail.svg",
    google_calendar: "/icons/google-calendar.svg",
    google_sheets: "/icons/google-sheets.svg",
    google_docs: "/icons/google-docs.svg",
    outlook: "/icons/outlook.svg",
    outlook_calendar: "/icons/outlook.svg",
    slack: "/icons/slack.svg",
    teams: "/icons/teams.svg",
    linear: "/icons/linear.svg",
    jira: "/icons/jira.svg",
    github: "/icons/github.svg",
    notion: "/icons/notion.svg",
    hubspot: "/icons/hubspot.svg",
    twitter: "/icons/x.svg",
    instagram: "/icons/instagram.svg",
    youtube: "/icons/youtube.svg",
    linkedin: "/icons/linkedin.svg",
  };

/**
 * Some Composio toolkits cover multiple orchestrator provider strings
 * from a single OAuth (Outlook's mail + calendar share one consent and
 * land as two integration rows). The chat chip should treat those as
 * one connected service so the count + icon stack reflect reality.
 */
function canonicalServiceKey(provider: HermesIntegrationProvider): string {
  if (provider === "outlook" || provider === "outlook_calendar") {
    return "outlook";
  }
  return provider;
}

function dedupeServiceIntegrations(
  integrations: HermesIntegrationPublic[],
): HermesIntegrationPublic[] {
  const seen = new Set<string>();
  const result: HermesIntegrationPublic[] = [];
  for (const integration of integrations) {
    const key = canonicalServiceKey(integration.provider);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(integration);
  }
  return result;
}

/**
 * Top-right chip opening the Autonomy panel — the home for "what the
 * assistant does on its own" (autonomy level + scheduled tasks). Styled to
 * match IntegrationsChip so the two controls read as one cluster.
 */
export function AutonomyChip({ onClick }: { onClick: () => void }) {
  const tPanel = useTranslations("App.Hermes.AutonomyPanel");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className="border-border bg-card text-foreground hover:bg-muted/40 hover:border-foreground/30 inline-flex h-8 items-center gap-2 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={tPanel("title")}
        >
          <Zap className="text-tertiary-foreground size-3.5" aria-hidden />
          <span>{tPanel("chip")}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tPanel("subtitle")}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Top-right chip opening the Skills marketplace popup — browse, search and
 * install skills without leaving the chat. Styled to match the other chips.
 */
export function SkillsChip({ onClick }: { onClick: () => void }) {
  const t = useTranslations("App.Hermes.SkillsPanel");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className="border-border bg-card text-foreground hover:bg-muted/40 hover:border-foreground/30 inline-flex h-8 items-center gap-2 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={t("title")}
        >
          <Blocks className="text-tertiary-foreground size-3.5" aria-hidden />
          <span>{t("chip")}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{t("tooltip")}</TooltipContent>
    </Tooltip>
  );
}

export function IntegrationsChip({
  integrations,
  onClick,
}: {
  integrations: HermesIntegrationPublic[];
  onClick: () => void;
}) {
  const t = useTranslations("App.Hermes.Running.integrationsChip");
  const tRunning = useTranslations("App.Hermes.Running");
  // Dedupe paired providers (outlook + outlook_calendar share one OAuth)
  // so the chip shows one entry per real service. Otherwise a single
  // Outlook connection looks like "2 connected" with the same icon twice.
  const connected = dedupeServiceIntegrations(
    integrations.filter((i) => i.status === "connected"),
  );
  const stacked = connected.slice(0, 3);
  const hasAny = connected.length > 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className="border-border bg-card text-foreground hover:bg-muted/40 hover:border-foreground/30 inline-flex h-8 items-center gap-2 rounded-full border pl-1.5 pr-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={
            hasAny
              ? t("ariaConnected", { count: connected.length })
              : tRunning("settingsCta")
          }
        >
          {hasAny ? (
            <>
              <span className="flex items-center -space-x-1.5">
                {stacked.map((i) => (
                  <span
                    key={i.provider}
                    className="border-card bg-background inline-flex size-5 items-center justify-center rounded-full border-2"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={INTEGRATION_ICON_BY_PROVIDER[i.provider]}
                      alt=""
                      className="size-3"
                    />
                  </span>
                ))}
              </span>
              <span className="tabular-nums">{connected.length}</span>
            </>
          ) : (
            <>
              <SettingsIcon
                className="text-tertiary-foreground size-3.5"
                aria-hidden
              />
              <span>{tRunning("settingsCta")}</span>
            </>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {hasAny ? t("integrations") : tRunning("settingsCta")}
      </TooltipContent>
    </Tooltip>
  );
}
