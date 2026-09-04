import type { Coworker, SokoBot } from "@/lib/clients/generated/core";
import type { CoworkerOption } from "@/lib/types/coworker";

import { COWORKER_FALLBACK_IMAGES } from "./coworker-fallback-images";

export interface OwnerOrchestratorCopy {
  fallbackName: string;
  vendorName: string;
}

function sokoBotsVendor(vendorName: string): CoworkerOption["vendor"] {
  return {
    id: "soko-bots",
    name: vendorName,
    slug: "soko-bots",
    logos: {
      light: null,
      dark: null,
    },
  };
}

function normalizeCoworkerSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

export function getCoworkerOptions(coworkers: Coworker[]): CoworkerOption[] {
  return coworkers
    .map((coworker) => {
      const slug = coworker.slug?.toLowerCase() ?? coworker.name.toLowerCase();
      const profile = coworker.metadata?.profile;
      return {
        id: coworker.id,
        slug,
        name: coworker.name,
        kind: "coworker" as const,
        image: coworker.image || COWORKER_FALLBACK_IMAGES[slug] || "",
        description: coworker.description || undefined,
        caption: coworker.caption || undefined,
        vendor: {
          id: coworker.vendor.id,
          name: coworker.vendor.name,
          slug: coworker.vendor.slug,
          logos: coworker.vendor.logos,
        },
        priority: coworker.priority ?? 0,
        profile: profile
          ? {
              llm: profile.llm?.length ? profile.llm : undefined,
              hosting: profile.hosting || undefined,
              capabilities: profile.capabilities?.length
                ? profile.capabilities
                : undefined,
              examples: profile.examples?.length ? profile.examples : undefined,
            }
          : undefined,
        offers: coworker.metadata?.offers?.length
          ? coworker.metadata.offers
          : undefined,
      };
    })
    .sort(
      (a, b) =>
        (b.priority ?? 0) - (a.priority ?? 0) || a.name.localeCompare(b.name),
    );
}

/** Resolves a coworker id from a URL slug (case-insensitive). */
export function findCoworkerIdBySlug(
  options: CoworkerOption[],
  slug: string,
): string | null {
  const normalized = normalizeCoworkerSlug(slug);
  if (!normalized) return null;
  const match = options.find(
    (option) => normalizeCoworkerSlug(option.slug) === normalized,
  );
  return match?.id ?? null;
}

export function getOwnerOrchestratorOption(
  bot: SokoBot | null,
  copy: OwnerOrchestratorCopy,
): CoworkerOption | null {
  if (!bot) {
    return null;
  }

  return {
    id: bot.id,
    slug: "soko-bots",
    name: bot.name?.trim() || copy.fallbackName,
    image: bot.avatarImageUrl ?? "",
    kind: "orchestrator",
    avatarSeed: bot.avatarSeed,
    vendor: sokoBotsVendor(copy.vendorName),
  };
}

export function withOwnerOrchestratorOption(
  options: CoworkerOption[],
  bot: SokoBot | null,
  copy: OwnerOrchestratorCopy,
): CoworkerOption[] {
  const option = getOwnerOrchestratorOption(bot, copy);
  if (!option) {
    return options;
  }
  if (options.some((candidate) => candidate.id === option.id)) {
    return options;
  }
  return [option, ...options];
}

export function resolveTaskAssigneeFields(
  selectedId: string | null | undefined,
  options: ReadonlyArray<Pick<CoworkerOption, "id" | "kind">>,
  knownOrchestratorId?: string | null,
): { assigneeId: string | null; assigneeOrchestratorId: string | null } {
  if (!selectedId) {
    return { assigneeId: null, assigneeOrchestratorId: null };
  }

  const selected = options.find((option) => option.id === selectedId);
  if (selected?.kind === "orchestrator") {
    return { assigneeId: null, assigneeOrchestratorId: selectedId };
  }
  if (selected) {
    return { assigneeId: selectedId, assigneeOrchestratorId: null };
  }

  if (knownOrchestratorId && selectedId === knownOrchestratorId) {
    return { assigneeId: null, assigneeOrchestratorId: selectedId };
  }

  return { assigneeId: selectedId, assigneeOrchestratorId: null };
}

export function taskFormAssigneeId(task: {
  assigneeId?: string | null;
  assigneeOrchestratorId?: string | null;
}): string {
  return task.assigneeOrchestratorId ?? task.assigneeId ?? "";
}
