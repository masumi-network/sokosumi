import "server-only";

import type { SharedSokoBotSummary } from "@sokosumi/core-client";

import { getProjectFilterOptions } from "@/lib/helpers/project-filter-options";
import { sokoBotService } from "@/lib/services/soko-bot.service";

import type { CreateSokoBotProject } from "./components/create-soko-bot-dialog.client";

export interface SharedBotsLoad {
  bots: SharedSokoBotSummary[];
  projects: CreateSokoBotProject[];
}

/**
 * Shared bots and the projects they can work for, or `null` when Core sends
 * no `sharedBots` or the read fails. `null` hides every shared-bot surface.
 */
export async function loadSharedBots(): Promise<SharedBotsLoad | null> {
  const bots = await sokoBotService.listShared().catch(() => null);
  if (!bots) return null;
  const projects = await getProjectFilterOptions().catch(() => []);
  return {
    bots,
    projects: projects.map(({ id, name }) => ({ id, name })),
  };
}
