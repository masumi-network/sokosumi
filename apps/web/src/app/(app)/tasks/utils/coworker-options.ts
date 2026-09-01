import type { Coworker } from "@/lib/clients/generated/core";
import type { CoworkerOption } from "@/lib/types/coworker";

import { COWORKER_FALLBACK_IMAGES } from "./coworker-fallback-images";

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
        sokoBotId: coworker.sokoBotId ?? null,
        ownerUserId: coworker.ownerUserId ?? null,
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

export interface CoworkerAssigneeGroups {
  marketplace: CoworkerOption[];
  nestedByOwnerId: Map<string, CoworkerOption[]>;
  unownedPersonalAssistants: CoworkerOption[];
}

function isPersonalAssistantOption(option: CoworkerOption): boolean {
  return Boolean(option.sokoBotId);
}

export function groupCoworkerAssigneeOptions(
  options: CoworkerOption[],
  memberIds: Iterable<string>,
): CoworkerAssigneeGroups {
  const memberIdSet = new Set(memberIds);
  const marketplace: CoworkerOption[] = [];
  const nestedByOwnerId = new Map<string, CoworkerOption[]>();
  const unownedPersonalAssistants: CoworkerOption[] = [];

  for (const option of options) {
    if (!isPersonalAssistantOption(option)) {
      marketplace.push(option);
      continue;
    }

    const ownerUserId = option.ownerUserId;
    if (ownerUserId && memberIdSet.has(ownerUserId)) {
      const owned = nestedByOwnerId.get(ownerUserId);
      if (owned) {
        owned.push(option);
      } else {
        nestedByOwnerId.set(ownerUserId, [option]);
      }
      continue;
    }

    unownedPersonalAssistants.push(option);
  }

  return { marketplace, nestedByOwnerId, unownedPersonalAssistants };
}
