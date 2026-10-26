import { CHANNEL_SLUG_MAX_LENGTH, sanitizeChannelSlug } from "@sokosumi/utils";

/**
 * A channel slug unique per Organization because `id` is in it; the name only
 * makes it read well, and `fallback` stands in when the name has nothing
 * slug-safe.
 */
export function channelSlugWithId(
  name: string,
  id: string,
  fallback: string,
): string {
  const head = sanitizeChannelSlug(name).slice(
    0,
    CHANNEL_SLUG_MAX_LENGTH - id.length - 1,
  );
  return `${head.replace(/-+$/, "") || fallback}-${id}`;
}
