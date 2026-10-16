import type { Prisma } from "@sokosumi/database";
import {
  getSokoBotIntegrationProvider,
  SOKO_BOT_INTEGRATION_PROVIDERS,
} from "@sokosumi/soko-bot";

import { getComposio } from "@/clients/composio.client";
import prisma from "@/lib/db/prisma";
import {
  catalogLogos,
  requireBot,
} from "@/services/soko-bot-integrations.service";

const INTEGRATION_SELECT = {
  id: true,
  provider: true,
  name: true,
  logoUrl: true,
  status: true,
  connectedAt: true,
  lastIngestAt: true,
  lastError: true,
} satisfies Prisma.SokoBotIntegrationSelect;

export interface SokoBotIntegrationList {
  configured: boolean;
  integrations: SokoBotIntegrationView[];
}

export interface SokoBotIntegrationView {
  provider: string;
  name: string;
  logoUrl: string | null;
  kinds: readonly string[];
  status: "DISCONNECTED" | "PENDING" | "ACTIVE" | "FAILED" | "REVOKED";
  connectedAt: Date | null;
  lastIngestAt: Date | null;
  lastError: string | null;
}

/** The member's own bot's integrations, as the `me` route lists them. */
export async function listSokoBotIntegrations(
  userId: string,
  workspaceId: string,
): Promise<SokoBotIntegrationList> {
  const bot = await requireBot(userId, workspaceId);
  return listSokoBotIntegrationsForBot(bot.id);
}

/**
 * Every provider, with one bot's connection state; disconnected ones too.
 * A runtime turn lists its own bot's, so a shared bot never shows the
 * member's personal bot.
 */
export async function listSokoBotIntegrationsForBot(
  sokoBotId: string,
): Promise<SokoBotIntegrationList> {
  const rows = await prisma.sokoBotIntegration.findMany({
    where: { sokoBotId },
    select: INTEGRATION_SELECT,
  });
  const logos = await catalogLogos();
  const connected: SokoBotIntegrationView[] = rows.map((row) => {
    const known = getSokoBotIntegrationProvider(row.provider);
    return {
      provider: row.provider,
      name: row.name ?? known?.name ?? row.provider,
      logoUrl: row.logoUrl ?? known?.logoUrl ?? logos.get(row.provider) ?? null,
      kinds: known?.kinds ?? [],
      status: row.status,
      connectedAt: row.connectedAt,
      lastIngestAt: row.lastIngestAt,
      lastError: row.lastError,
    };
  });
  // Mail and calendar providers are always offered; everything else comes
  // from the catalog search.
  const featured: SokoBotIntegrationView[] =
    SOKO_BOT_INTEGRATION_PROVIDERS.filter(
      (provider) => !rows.some((row) => row.provider === provider.id),
    ).map((provider) => ({
      provider: provider.id,
      name: provider.name,
      logoUrl: provider.logoUrl || logos.get(provider.id) || null,
      kinds: provider.kinds,
      status: "DISCONNECTED",
      connectedAt: null,
      lastIngestAt: null,
      lastError: null,
    }));
  return {
    configured: getComposio() !== null,
    integrations: [...connected, ...featured],
  };
}
