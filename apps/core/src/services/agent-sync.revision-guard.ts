import * as Sentry from "@sentry/node";
import { AgentEntryType } from "@sokosumi/database";

/**
 * Revision-exposure guard: decides when a registry update must unpublish an
 * existing row instead of letting the refreshed fields inherit its curated
 * `isShown` exposure. Core cannot verify locally that the writer of the new
 * revision data is the seller the operator reviewed — that guarantee lives in
 * the registry validator — so any change to the surface the curation was
 * granted for (the hireable API endpoint, or a pointer entry's discovery
 * identity) fails closed and waits for an admin re-publish. In-flight jobs
 * are unaffected: they pin their own endpoint snapshot via
 * `toMasumiAgentForJob`.
 */

interface CurationSurfaceFields {
  type: AgentEntryType;
  apiBaseUrl: string | null;
  x402ResourcesUrl: string | null;
  openApiSpecUrl: string | null;
}

export interface RevisionGuardExistingAgent extends CurationSurfaceFields {
  id: string;
  registryVersion: number;
  isShown: boolean;
}

export interface RevisionExposureGuardInput {
  existing: RevisionGuardExistingAgent;
  incomingFields: CurationSurfaceFields;
  registryIdentity: string;
  incomingRegistryVersion: number;
}

const POINTER_ENTRY_TYPES: ReadonlySet<AgentEntryType> = new Set([
  AgentEntryType.X402,
  AgentEntryType.OPEN_API,
]);

function getPointerDiscoveryUrl(fields: CurationSurfaceFields): string | null {
  switch (fields.type) {
    case AgentEntryType.X402:
      return fields.x402ResourcesUrl;
    case AgentEntryType.OPEN_API:
      return fields.openApiSpecUrl;
    default:
      return null;
  }
}

/**
 * A pointer entry's discovery identity is its entry type plus the
 * type-specific discovery URL. Unlike the endpoint guard this does NOT wait
 * for a revision promotion: the projection rewrites these fields on every
 * sync update, so a same-version metadata edit can move them too.
 *
 * Mirrors the endpoint guard's add-carve-out: a pointer that merely GAINS a
 * discovery URL had nothing listed to hijack (the catalogs drop entries
 * without a valid URL), so it stays curated.
 */
export function changesPointerDiscoveryIdentity(
  existing: CurationSurfaceFields,
  incoming: CurationSurfaceFields,
): boolean {
  if (existing.type !== incoming.type) {
    return (
      POINTER_ENTRY_TYPES.has(existing.type) ||
      POINTER_ENTRY_TYPES.has(incoming.type)
    );
  }
  const previousUrl = getPointerDiscoveryUrl(existing);
  return (
    previousUrl !== null && getPointerDiscoveryUrl(incoming) !== previousUrl
  );
}

/**
 * Returns whether the update must write `isShown: false`. Pages once per
 * tripped guard, but only when the row was actually exposed — unpublishing an
 * already-hidden row is a silent no-op.
 */
export function evaluateRevisionExposureGuard({
  existing,
  incomingFields,
  registryIdentity,
  incomingRegistryVersion,
}: RevisionExposureGuardInput): boolean {
  const isRevisionPromotion =
    incomingRegistryVersion > existing.registryVersion;
  // A promotion rewrites the canonical row — endpoint, pricing, payment
  // sources — while the ratings, categories and risk rating of the previous
  // revision stay attached. When a promotion MOVES THE ENDPOINT, the new
  // endpoint must not inherit a curated, well-rated listing. A revision that
  // merely ADDS an endpoint to a pointer entry has nothing curated to hijack.
  const promotedEndpoint =
    isRevisionPromotion &&
    incomingFields.apiBaseUrl !== existing.apiBaseUrl &&
    existing.apiBaseUrl !== null;
  const changedDiscovery = changesPointerDiscoveryIdentity(
    existing,
    incomingFields,
  );

  if (promotedEndpoint && existing.isShown) {
    Sentry.captureMessage(
      "Agent revision promotion changed the API endpoint; unpublishing pending review",
      {
        level: "error",
        tags: { error_type: "agent_revision_endpoint_changed" },
        extra: {
          agentId: existing.id,
          registryIdentity,
          fromVersion: existing.registryVersion,
          toVersion: incomingRegistryVersion,
          previousApiBaseUrl: existing.apiBaseUrl,
          nextApiBaseUrl: incomingFields.apiBaseUrl,
        },
      },
    );
  }
  if (changedDiscovery && existing.isShown) {
    Sentry.captureMessage(
      "Agent revision changed its discovery identity; unpublishing pending review",
      {
        level: "error",
        tags: { error_type: "agent_revision_discovery_changed" },
        extra: {
          agentId: existing.id,
          registryIdentity,
          fromVersion: existing.registryVersion,
          toVersion: incomingRegistryVersion,
          previousType: existing.type,
          nextType: incomingFields.type,
          previousDiscoveryUrl: getPointerDiscoveryUrl(existing),
          nextDiscoveryUrl: getPointerDiscoveryUrl(incomingFields),
        },
      },
    );
  }

  return promotedEndpoint || changedDiscovery;
}
