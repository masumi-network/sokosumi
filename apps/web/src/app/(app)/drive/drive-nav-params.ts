import type { ReadonlyURLSearchParams } from "next/navigation";

function withoutLegacyDriveScopeParam(
  params: ReadonlyURLSearchParams | URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(params.toString());
  next.delete("scope");
  return next;
}

/**
 * The query a drive navigation should carry forward.
 *
 * Drops the legacy `scope`, and `archived` — which only the Tables list reads.
 * Every caller here rebuilds the query from the current URL and then navigates
 * into browse or tasks, so without this a `?archived=true` left over from the
 * Tables tab rides along into views that ignore it and ends up in shared links.
 * `navigateToPrimaryView` clears it through nuqs for the same reason.
 */
export function driveNavParams(
  params: ReadonlyURLSearchParams | URLSearchParams,
): URLSearchParams {
  const next = withoutLegacyDriveScopeParam(params);
  next.delete("archived");
  next.delete("tags");
  return next;
}
