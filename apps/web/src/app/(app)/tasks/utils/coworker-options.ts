import type { Coworker } from "@/lib/clients/generated/core";
import type { CoworkerOption } from "@/lib/types/coworker";

import { COWORKER_FALLBACK_IMAGES } from "./coworker-fallback-images";

export function getCoworkerOptions(coworkers: Coworker[]): CoworkerOption[] {
  return coworkers.map((coworker) => {
    const slug = coworker.slug?.toLowerCase() ?? coworker.name.toLowerCase();
    return {
      id: coworker.id,
      slug,
      name: coworker.name,
      image: coworker.image || COWORKER_FALLBACK_IMAGES[slug] || "",
      description: coworker.description || undefined,
    };
  });
}

/** Resolves a coworker id from a URL slug (case-insensitive). */
export function findCoworkerIdBySlug(
  options: CoworkerOption[],
  slug: string,
): string | null {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) return null;
  const match = options.find(
    (option) => option.slug.toLowerCase() === normalized,
  );
  return match?.id ?? null;
}
