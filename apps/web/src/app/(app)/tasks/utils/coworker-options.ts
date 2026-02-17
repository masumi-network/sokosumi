import type { Coworker } from "@sokosumi/database";

import type { CoworkerOption } from "@/lib/types/coworker";

import { COWORKER_FALLBACK_IMAGES } from "./coworker-fallback-images";

export function getCoworkerOptions(coworkers: Coworker[]): CoworkerOption[] {
  return coworkers.map((coworker) => {
    const slug = coworker.slug?.toLowerCase() ?? coworker.name.toLowerCase();
    return {
      id: coworker.id,
      name: coworker.name,
      image: coworker.image || COWORKER_FALLBACK_IMAGES[slug] || "",
      description: coworker.description || undefined,
    };
  });
}
