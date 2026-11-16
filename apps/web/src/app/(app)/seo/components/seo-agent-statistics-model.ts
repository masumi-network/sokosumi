/** Why no Google Analytics data is saved: each state names its cause and, where one exists, its fix. */
export type SeoAnalyticsState =
  | "unknown"
  | "missing"
  | "loading"
  | "failed"
  | "no_property"
  | "choose"
  | "empty";

/**
 * The cause the Google statistics line names. A connection that is not read yet has no state. A connection
 * that is expired or not finished reads as none. A cause the reader can fix comes before a sync that runs: a
 * refetch on focus would hide its button. "Empty" needs a collection that finished.
 */
export function seoAnalyticsState({
  status,
  sync,
  properties,
}: {
  /** The status of the Google connection; undefined while it is not read. */
  status: string | undefined;
  sync: {
    collected: boolean;
    loading: boolean;
    failed: boolean;
    needsProperty: boolean;
  };
  /** The number of Analytics properties of the account; null while the list is not read. */
  properties: number | null;
}): SeoAnalyticsState {
  // Not read yet, or not offered here: the connect button speaks for itself.
  if (status === undefined || status === "unavailable") return "unknown";
  if (status !== "connected") return "missing";
  if (sync.failed) return "failed";
  if (properties === 0) return "no_property";
  if (sync.needsProperty) return "choose";
  if (sync.collected) return "empty";
  if (sync.loading) return "loading";
  return "unknown";
}

/** The fix the line offers for its cause; null where the cause has none. */
export function seoAnalyticsAction(
  state: SeoAnalyticsState,
  connected: boolean,
  properties: number,
): "connect" | "choose" | "manage" | null {
  if (state === "missing" || (state === "unknown" && !connected))
    return "connect";
  if (state === "choose") return "choose";
  // One property or none: the connections dialog is where another account or property comes from.
  if (state === "no_property") return "manage";
  if (state === "empty") return properties < 2 ? "manage" : "choose";
  return null;
}
