import type { SokoBotIntegrations } from "@sokosumi/core-client";

export interface SokoBotConnectOffer {
  provider: string;
  name: string;
  connected: boolean;
}

/** What the chat's "connect your inbox and calendar" card shows; null hides it. */
export interface SokoBotConnectPromptState {
  botId: string;
  botName: string;
  offers: SokoBotConnectOffer[];
}

/**
 * Gmail and Google Calendar feed the bot's briefs and meeting prep; Teams is a
 * Composio toolkit the bot uses through its integration tools. All three go
 * through the same connect flow.
 */
const PROMPT_PROVIDERS = [
  { provider: "gmail", name: "Gmail" },
  { provider: "googlecalendar", name: "Google Calendar" },
  { provider: "microsoft_teams", name: "Microsoft Teams" },
] as const;

/**
 * The card stays while mail or calendar has no active connection (any
 * provider of that kind counts), and lists each provider with its own state.
 */
export function connectOffers(
  integrations: SokoBotIntegrations["integrations"],
): SokoBotConnectOffer[] {
  const active = integrations.filter((i) => i.status === "ACTIVE");
  const covered = (kind: "email" | "calendar") =>
    active.some((i) => i.kinds.includes(kind));
  if (covered("email") && covered("calendar")) return [];
  const activeProviders = new Set(active.map((i) => i.provider));
  return PROMPT_PROVIDERS.map((offer) => ({
    ...offer,
    connected: activeProviders.has(offer.provider),
  }));
}
