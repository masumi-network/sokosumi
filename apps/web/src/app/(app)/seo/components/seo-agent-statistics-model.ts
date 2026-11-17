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
  picked,
}: {
  /** The status of the Google connection; undefined while it is not read. */
  status: string | undefined;
  sync: {
    collected: boolean;
    loading: boolean;
    failed: boolean;
  };
  /** The number of Analytics properties of the account; null while the list is not read. */
  properties: number | null;
  /** A property is in use: picked, or the one property of the account. Read here, not from the sync, which
   * does not run for a viewer who cannot sync. */
  picked: boolean;
}): SeoAnalyticsState {
  // A read that failed, the connection's own too, is the upkeep line's: one alert, one Try again.
  if (sync.failed) return "failed";
  // Not read yet, or not offered here: the connect button speaks for itself.
  if (status === undefined || status === "unavailable") return "unknown";
  if (status !== "connected") return "missing";
  if (properties === 0) return "no_property";
  if (properties !== null && !picked) return "choose";
  if (sync.collected) return "empty";
  if (sync.loading) return "loading";
  return "unknown";
}

/**
 * The line has nothing to say: a connected account with no cause yet, or a sync that runs or failed, which the
 * upkeep line of the verdict card says once, with its Try again.
 */
export function seoAnalyticsHidden(
  state: SeoAnalyticsState,
  connected: boolean,
): boolean {
  return (
    (state === "unknown" && connected) ||
    state === "loading" ||
    state === "failed"
  );
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
