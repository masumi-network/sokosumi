import { record } from "@/clients/composio.client";

function counter(value: unknown): number | null {
  const parsed =
    typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)
      ? Number(value)
      : value;
  return typeof parsed === "number" &&
    Number.isSafeInteger(parsed) &&
    parsed >= 0
    ? parsed
    : null;
}

/** Graph `shares.count` is often 0; Insights reports shares under this breakdown. */
export function facebookInsightShareCount(
  data: Record<string, unknown> | null,
): number | null {
  if (!Array.isArray(data?.data)) return null;
  for (const item of data.data) {
    const metric = record(item);
    if (metric?.name !== "post_activity_by_action_type") continue;
    const total = record(metric.total_value)?.value;
    const first = Array.isArray(metric.values)
      ? record(metric.values[0])?.value
      : undefined;
    const raw = record(total) ?? record(first);
    const shares = counter(raw?.share ?? raw?.shares);
    if (shares !== null) return shares;
  }
  return null;
}

/** Graph `0` is untrusted unless Insights reports a share count. */
export function facebookShareCount(
  graphCount: number | null,
  insightPayload: Record<string, unknown> | null,
): number | null {
  return facebookInsightShareCount(insightPayload) ?? (graphCount || null);
}
