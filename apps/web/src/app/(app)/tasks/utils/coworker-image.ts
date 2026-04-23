import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";

import { COWORKER_FALLBACK_IMAGES } from "./coworker-fallback-images";

interface CoworkerImageSource {
  image?: string | null;
  slug?: string | null;
  name?: string | null;
}

export function getCoworkerImage(
  coworker: CoworkerImageSource | null | undefined,
): string | null {
  if (coworker?.image) {
    return resolveIpfsOrHttpUrl(coworker.image);
  }
  const slug = coworker?.slug?.toLowerCase() ?? coworker?.name?.toLowerCase();
  if (slug && COWORKER_FALLBACK_IMAGES[slug]) {
    return COWORKER_FALLBACK_IMAGES[slug];
  }
  return null;
}
