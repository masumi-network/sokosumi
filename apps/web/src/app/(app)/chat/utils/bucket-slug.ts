/**
 * Encode bucket key (model:id or coworker:id) to a URL-safe slug for /chat/[bucketSlug]/...
 * Reversible so we can decode the slug back to the bucket key.
 */
const BUCKET_SEP = "__";
const SLASH_PLACEHOLDER = "___";

/**
 * Human-readable URL slug from a display name (e.g. "Gemini 3.0" → "gemini-3-0", "Hannah" → "hannah").
 */
export function slugify(name: string): string {
  if (!name || typeof name !== "string") return "";
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Human-readable slug for chat URLs from conversation metadata.
 * Prefers coworker_slug (already URL-safe), then slugified coworker_name or model_name.
 */
export function displaySlugFromMetadata(
  metadata: Record<string, unknown> | null,
): string {
  if (!metadata) return "";
  const coworkerSlug = metadata.coworker_slug as string | undefined;
  if (coworkerSlug && typeof coworkerSlug === "string") {
    const s = slugify(coworkerSlug);
    if (s) return s;
  }
  const coworkerName = metadata.coworker_name as string | undefined;
  if (coworkerName) {
    const s = slugify(coworkerName);
    if (s) return s;
  }
  const modelName = metadata.model_name as string | undefined;
  if (modelName) {
    const s = slugify(modelName);
    if (s) return s;
  }
  return "";
}

export function bucketKeyToSlug(bucketKey: string): string {
  if (!bucketKey) return "";
  return bucketKey.replace(/\//g, SLASH_PLACEHOLDER).replace(/:/g, BUCKET_SEP);
}

export function slugToBucketKey(slug: string): string {
  if (!slug) return "";
  const parts = slug.split(BUCKET_SEP);
  if (parts.length < 2) return "";
  const type = parts[0];
  const id = parts
    .slice(1)
    .join(BUCKET_SEP)
    .replace(new RegExp(SLASH_PLACEHOLDER, "g"), "/");
  return `${type}:${id}`;
}

export function getBucketKeyFromMetadata(
  metadata: Record<string, unknown> | null,
): string {
  if (!metadata) return "other";
  const conversationType = metadata.type as string | undefined;
  const coworkerSlug =
    (metadata.coworker_slug as string | undefined) ??
    (metadata.coworkerSlug as string | undefined);
  const coworkerId =
    (metadata.coworker_id as string | undefined) ??
    (metadata.coworkerId as string | undefined);
  const modelId =
    (metadata.model_id as string | undefined) ??
    (metadata.modelId as string | undefined);

  if (conversationType === "coworker") {
    if (coworkerSlug) return `coworker:${coworkerSlug}`;
    if (coworkerId) return `coworker:${coworkerId}`;
    return "other";
  }

  if (conversationType === "model") {
    if (modelId) return `model:${modelId}`;
    return "other";
  }

  if (coworkerSlug) return `coworker:${coworkerSlug}`;
  if (coworkerId) return `coworker:${coworkerId}`;
  if (modelId) return `model:${modelId}`;
  return "other";
}

/**
 * Resolve human-readable URL slug back to bucket key by matching conversation groups.
 * Falls back to slugToBucketKey for legacy encoded slugs (e.g. coworker__uuid).
 */
export function bucketKeyFromDisplaySlug(
  conversations: { metadata: unknown }[],
  displaySlug: string,
): string | null {
  if (!displaySlug) return null;
  const slugLower = displaySlug.trim().toLowerCase();
  const byKey = new Map<string, { displaySlug: string }>();
  for (const c of conversations) {
    const meta = (c.metadata as Record<string, unknown> | null) ?? null;
    const key = getBucketKeyFromMetadata(meta);
    if (key === "other") continue;
    if (!byKey.has(key)) {
      byKey.set(key, { displaySlug: displaySlugFromMetadata(meta) });
    }
  }
  for (const [key, { displaySlug }] of byKey) {
    if (displaySlug && displaySlug.toLowerCase() === slugLower) return key;
  }
  const legacyKey = slugToBucketKey(displaySlug);
  if (legacyKey) return legacyKey;
  return null;
}
