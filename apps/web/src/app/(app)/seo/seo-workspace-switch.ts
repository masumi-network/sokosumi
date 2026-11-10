import "server-only";

import { unstable_rethrow } from "next/navigation";
import { loadWorkspaceSwitchAccounts } from "@/app/components/user-avatar/workspace-switch-accounts";
import { getSession } from "@/lib/auth/auth.server";
import type { SeoOwner } from "@/lib/seo/owner";
import { seoService } from "@/lib/services/seo.service";
import type { SeoWorkspaceSwitchDialogProps } from "./components/seo-workspace-switch-dialog";

// 404: the active workspace does not hold the Audit. 403: the reader has no
// seat in the active workspace, which says nothing about where the Audit is.
const ELSEWHERE_STATUSES = new Set([403, 404]);

/**
 * The switch that opens an Audit link, when the Audit is in another workspace
 * of this reader. Null when there is nothing to switch to: the page then
 * keeps its "not available" text.
 */
export async function seoAuditSwitchFor(
  owner: SeoOwner | undefined,
  status: number | undefined,
): Promise<SeoWorkspaceSwitchDialogProps | null> {
  if (
    owner?.kind !== "audit" ||
    status === undefined ||
    !ELSEWHERE_STATUSES.has(status)
  )
    return null;
  const [mapping, session] = await Promise.all([
    seoService.getAuditWorkspaceMapping(owner.id),
    getSession(),
  ]);
  if (!mapping || !session) return null;
  const targetOrganizationId = mapping.organizationId ?? null;
  // The Audit is in this workspace: the failed read is not a wrong workspace.
  if ((session.session.activeOrganizationId ?? null) === targetOrganizationId)
    return null;
  try {
    return {
      ...(await loadWorkspaceSwitchAccounts(session, targetOrganizationId)),
      auditName: mapping.name,
    };
  } catch (error) {
    // A failed read of the reader's organizations must not replace the page's own text with an error page.
    unstable_rethrow(error);
    return null;
  }
}
