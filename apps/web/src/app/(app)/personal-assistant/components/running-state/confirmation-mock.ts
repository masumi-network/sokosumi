import { isConfirmationOrgAwareTool } from "@/app/personal-assistant/components/confirmation-org-picker";
import type { HermesPendingConfirmation } from "@/lib/hermes/types";

/**
 * Same RFC-4122 UUID pattern the server uses to resolve coworker /
 * organization ids in the summary. Splitting on this lets us interleave
 * `<CoworkerRefChip>` / `<OrgRefChip>` exactly where the orchestrator
 * wrote the id.
 */
export const SUMMARY_UUID_PATTERN =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

/**
 * Dev preview: synthesizes a fake pending confirmation referencing a real
 * coworker so the ConfirmationCard renders with avatar + name chips
 * locally, without waiting on the orchestrator. Activated by
 * `?state=running&mock=confirmation`. Optional overrides via
 * `&toolName=sokosumi_create_job&assigneeId=<uuid>&coworkerName=<name>&coworkerImage=<url>`.
 * Legacy `coworkerId` is still accepted for bookmarked demo URLs.
 */
export function buildMockPendingConfirmations(
  params: Pick<URLSearchParams, "get">,
): HermesPendingConfirmation[] {
  if (params.get("mock") !== "confirmation") return [];
  const requestedToolName = params.get("toolName");
  const toolName =
    requestedToolName && isConfirmationOrgAwareTool(requestedToolName)
      ? requestedToolName
      : "sokosumi_create_task";
  const assigneeId =
    params.get("assigneeId") ??
    params.get("coworkerId") ??
    "0e8c93b0-5332-4734-b603-ea18d17b50c5";
  const coworkerName = params.get("coworkerName") ?? "Hannah";
  const coworkerImage = params.get("coworkerImage");
  const summary =
    toolName === "sokosumi_create_job"
      ? `Create a new job "Research: Teodor Petricevic — UNDP AltFinLab" and assign it to coworker ${assigneeId}.`
      : `Create a new task "Research: Teodor Petricevic — UNDP AltFinLab" and assign it to coworker ${assigneeId}.`;
  return [
    {
      id: "mock-confirmation-1",
      toolName,
      summary,
      createdAt: new Date().toISOString(),
      referencedCoworkers: [
        {
          id: assigneeId,
          name: coworkerName,
          image: coworkerImage,
        },
      ],
      referencedOrganizations: [],
      // Optional preview overrides for the proposed-workspace dropdown default.
      organizationId: params.get("organizationId"),
      organizationName: params.get("organizationName"),
    },
  ];
}
