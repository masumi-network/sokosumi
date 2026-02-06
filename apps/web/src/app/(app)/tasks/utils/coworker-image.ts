import { ipfsUrlResolver } from "@/lib/ipfs";
import type { TaskWithCoworker } from "@/lib/types/task";

const COWORKER_FALLBACK_IMAGES: Record<string, string> = {
  soko: "/images/kanji/sokosumi-logo-kanji-black.svg",
  sumi: "/images/kanji/sokosumi-logo-kanji-black.svg",
  hannah: "/images/coworkers/hannah.png",
};

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
