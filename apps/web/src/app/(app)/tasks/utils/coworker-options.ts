import type { Coworker } from "@sokosumi/database";

import type { CoworkerOption } from "@/lib/types/coworker";

import { COWORKER_FALLBACK_IMAGES } from "./coworker-fallback-images";

const COWORKER_DEFAULTS: Record<
  string,
  { image: string; description: string }
> = {
  soko: {
    image: COWORKER_FALLBACK_IMAGES.soko,
    description:
      "Your default AI coworker. Great for general tasks, research, and getting things done.",
  },
  hannah: {
    image: COWORKER_FALLBACK_IMAGES.hannah,
    description:
      "Creative strategist and communications expert. Ideal for content, marketing, and outreach.",
  },
};

export function getCoworkerOptions(coworkers: Coworker[]): CoworkerOption[] {
  return coworkers.map((coworker) => {
    const slug = coworker.slug?.toLowerCase() ?? coworker.name.toLowerCase();
    const defaults = COWORKER_DEFAULTS[slug];
    return {
      id: coworker.id,
      name: coworker.name,
      image: coworker.image || defaults?.image || "",
      description: coworker.description || defaults?.description || undefined,
    };
  });
}
