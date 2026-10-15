/**
 * A `scope` search param as written, trimmed, with `owned` (the old name of
 * `mine`, still found in saved URLs) read as `mine`. Callers still check the
 * value against the scopes their page offers.
 */
export function readWorkScopeParam(raw: string): string {
  const scope = raw.trim();
  return scope === "owned" ? "mine" : scope;
}
