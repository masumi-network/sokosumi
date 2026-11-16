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
  if (status === undefined) return "unknown";
  if (status !== "connected") return "missing";
  if (sync.failed) return "failed";
  if (properties === 0) return "no_property";
  if (sync.needsProperty) return "choose";
  if (sync.collected) return "empty";
  if (sync.loading) return "loading";
  return "unknown";
}
