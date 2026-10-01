import type { SokoBotIntegrations } from "@sokosumi/core-client";

export type SokoBotConnectKind = "email" | "calendar";

export interface SokoBotConnectOffer {
  kind: SokoBotConnectKind;
  provider: string;
  name: string;
}

/** What the chat's "connect mail and calendar" prompt shows; null hides it. */
export interface SokoBotConnectPromptState {
  botId: string;
  botName: string;
  missing: SokoBotConnectOffer[];
}

/**
 * Mail and calendar each count once: a kind with any active connection is
 * covered, otherwise its first offered provider (the catalog's order, Gmail
 * and Google Calendar first) is what the prompt connects.
 */
export function missingConnections(
  integrations: SokoBotIntegrations["integrations"],
): SokoBotConnectOffer[] {
  return (["email", "calendar"] as const).flatMap((kind) => {
    const ofKind = integrations.filter((i) => i.kinds.includes(kind));
    if (ofKind.some((i) => i.status === "ACTIVE")) return [];
    const offer = ofKind[0];
    return offer ? [{ kind, provider: offer.provider, name: offer.name }] : [];
  });
}
