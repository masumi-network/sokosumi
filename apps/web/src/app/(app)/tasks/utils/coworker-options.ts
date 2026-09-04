import type { Coworker, Member, SokoBot } from "@/lib/clients/generated/core";
import type { CoworkerOption } from "@/lib/types/coworker";

import { COWORKER_FALLBACK_IMAGES } from "./coworker-fallback-images";

/** Vendor bucket for workspace-member assignee options (SOK-868). */
export const WORKSPACE_MEMBERS_VENDOR = {
  id: "workspace-members",
  name: "Members",
  slug: "workspace-members",
  logos: { light: null, dark: null },
} as const;

export interface OwnerSokoBotCopy {
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

export function getOwnerSokoBotOption(
  bot: SokoBot | null,
  copy: OwnerSokoBotCopy,
): CoworkerOption | null {
  if (!bot) {
    return null;
  }

  return {
    id: bot.id,
    slug: "soko-bots",
    name: bot.name?.trim() || copy.fallbackName,
    image: bot.avatarImageUrl ?? "",
    kind: "sokoBot",
    avatarSeed: bot.avatarSeed,
    vendor: sokoBotsVendor(copy.vendorName),
  };
}

export function withOwnerSokoBotOption(
  options: CoworkerOption[],
  bot: SokoBot | null,
  copy: OwnerSokoBotCopy,
): CoworkerOption[] {
  const option = getOwnerSokoBotOption(bot, copy);
  if (!option) {
    return options;
  }
  if (options.some((candidate) => candidate.id === option.id)) {
    return options;
  }
  return [option, ...options];
}

export function getUserOptions(members: Member[]): CoworkerOption[] {
  const seen = new Set<string>();
  const options: CoworkerOption[] = [];
  for (const member of members) {
    const user = member.user;
    if (!user || seen.has(user.id)) continue;
    seen.add(user.id);
    options.push({
      id: user.id,
      slug: user.email?.toLowerCase() ?? user.id,
      name: user.name?.trim() || user.email || "Member",
      kind: "user" as const,
      image: user.image ?? "",
      vendor: { ...WORKSPACE_MEMBERS_VENDOR },
    });
  }
  return options.sort((a, b) => a.name.localeCompare(b.name));
}

export function resolveTaskAssigneeFields(
  selectedId: string | null | undefined,
  options: ReadonlyArray<Pick<CoworkerOption, "id" | "kind">>,
  knownSokoBotId?: string | null,
  knownUserId?: string | null,
): TaskAssigneeFields {
  if (!selectedId) {
    return clearedAssigneeFields();
  }

  const selected = options.find((option) => option.id === selectedId);
  if (selected?.kind === "sokoBot") {
    return clearedAssigneeFields({ assigneeSokoBotId: selectedId });
  }
  if (selected?.kind === "user") {
    return clearedAssigneeFields({ assigneeUserId: selectedId });
  }
  if (selected) {
    return clearedAssigneeFields({ assigneeId: selectedId });
  }

  if (knownSokoBotId && selectedId === knownSokoBotId) {
    return clearedAssigneeFields({ assigneeSokoBotId: selectedId });
  }

  if (knownUserId && selectedId === knownUserId) {
    return clearedAssigneeFields({ assigneeUserId: selectedId });
  }

  return clearedAssigneeFields({ assigneeId: selectedId });
}

export interface TaskAssigneeFields {
  assigneeId: string | null;
  assigneeSokoBotId: string | null;
  assigneeUserId: string | null;
}

function clearedAssigneeFields(
  overrides?: Partial<TaskAssigneeFields>,
): TaskAssigneeFields {
  return {
    assigneeId: null,
    assigneeSokoBotId: null,
    assigneeUserId: null,
    ...overrides,
  };
}

export function taskFormAssigneeId(task: {
  assigneeId?: string | null;
  assigneeSokoBotId?: string | null;
  assigneeUserId?: string | null;
}): string {
  return task.assigneeSokoBotId ?? task.assigneeId ?? task.assigneeUserId ?? "";
}
