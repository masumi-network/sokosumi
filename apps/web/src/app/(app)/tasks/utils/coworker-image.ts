import { ipfsUrlResolver } from "@/lib/ipfs";
import type { TaskWithCoworker } from "@/lib/types/task";

import { COWORKER_FALLBACK_IMAGES } from "./coworker-fallback-images";

export function getCoworkerImage(
  coworker: TaskWithCoworker["coworker"],
): string | null {
  if (coworker?.image) {
    return ipfsUrlResolver(coworker.image);
  }
  const slug = coworker?.slug?.toLowerCase() ?? coworker?.name?.toLowerCase();
  if (slug && COWORKER_FALLBACK_IMAGES[slug]) {
    return COWORKER_FALLBACK_IMAGES[slug];
  }
  return null;
}
