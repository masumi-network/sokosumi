import type { SeoOwner } from "@/lib/seo/owner";

const CONTEXT_UNAVAILABLE_STATUSES = new Set([401, 403, 404, 409]);
// Match the app's browser QueryClient default for transient failures only.
const MAX_TRANSIENT_RETRIES = 3;

/** Keep only HTTP status for recovery. Provider details and private error text stay out of the view. */
export function seoLoadErrorStatus(error: unknown): number | undefined {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number" &&
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status <= 599
  )
    return error.status;
  return undefined;
}

export class SeoWorkspaceLoadError extends Error {
  constructor(readonly status: number) {
    super("SEO workspace unavailable");
    this.name = "SeoWorkspaceLoadError";
  }
}

interface SeoLoadRecoveryInput {
  status?: number;
  invalidFilters?: boolean;
  owner?: SeoOwner;
  hasSelection?: boolean;
}

export function seoLoadRecovery({
  status,
  invalidFilters = false,
  owner,
  hasSelection = false,
}: SeoLoadRecoveryInput) {
  const contextual =
    status !== undefined && CONTEXT_UNAVAILABLE_STATUSES.has(status);
  // A Project owner is the Project's own SEO workspace: without `view` the page lists its Audits.
  const params = owner
    ? new URLSearchParams(
        owner.kind === "audit"
          ? { auditId: owner.id }
          : { projectId: owner.id, view: "project" },
      )
    : null;
  const named = hasSelection ? undefined : owner;
  return {
    contextual,
    canRetry: !contextual && !invalidFilters,
    // A named Audit or Project that this workspace cannot open usually lives in another one.
    // With a page or scope selected, the selection can be what is missing: the general text covers both.
    titleKey: !contextual
      ? ("errorTitle" as const)
      : !named
        ? ("unavailableTitle" as const)
        : named.kind === "audit"
          ? ("auditNotHereTitle" as const)
          : ("projectNotHereTitle" as const),
    bodyKey: invalidFilters
      ? ("invalidFilters" as const)
      : !contextual
        ? ("errorBody" as const)
        : named
          ? ("notHereBody" as const)
          : ("unavailableBody" as const),
    allPagesHref: hasSelection && params ? `/seo?${params}` : null,
  };
}

export function shouldRetrySeoLoad(
  failureCount: number,
  error: unknown,
): boolean {
  return (
    failureCount < MAX_TRANSIENT_RETRIES &&
    !seoLoadRecovery({ status: seoLoadErrorStatus(error) }).contextual
  );
}
