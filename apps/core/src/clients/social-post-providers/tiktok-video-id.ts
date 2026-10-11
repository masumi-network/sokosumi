const TIKTOK_VIDEO_ID = /^\d+$/;

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** Queryable TikTok video id. Publish ids and placeholder strings are not. */
export function tiktokPublishedVideoId(
  data: Record<string, unknown> | null,
): string | null {
  const available = data?.publicaly_available_post_id;
  const candidates = Array.isArray(available)
    ? available
    : available == null
      ? []
      : [available];
  for (const candidate of [...candidates, data?.post_id, data?.id]) {
    const id = stringOf(candidate);
    if (id && TIKTOK_VIDEO_ID.test(id)) return id;
  }
  return null;
}
