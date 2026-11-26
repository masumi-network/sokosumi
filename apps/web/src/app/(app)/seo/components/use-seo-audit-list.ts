"use client";

import type { SeoAuditSummary } from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/auth/auth.client";
import { seoViewerHeaders } from "@/lib/seo/owner";
import { seoAuditListRefetchMs } from "./seo-audit-status";

type AuditListScope = {
  projectId: string | null;
  archived: boolean;
  cursor: string | null;
};

/**
 * The Audit list the server rendered, read again while a check is open. The server list sits in a cache, so a
 * page refresh cannot be trusted to bring the new status; this reads only the list.
 */
export function useSeoAuditList(
  serverAudits: SeoAuditSummary[],
  { projectId, archived, cursor }: AuditListScope,
  enabled: boolean,
) {
  const { data: session } = useSession();
  const search = new URLSearchParams();
  if (projectId) search.set("projectId", projectId);
  if (archived) search.set("status", "archived");
  if (cursor) search.set("cursor", cursor);
  const query = useQuery({
    // A new server list (after an archive, say) is a new entry, so a cached poll never hides it.
    queryKey: [
      "seo-audit-list",
      session?.session.activeOrganizationId,
      session?.user.id,
      search.toString(),
      serverAudits,
    ],
    queryFn: async ({ signal }): Promise<SeoAuditSummary[]> => {
      const response = await fetch(`/api/seo/audits?${search}`, {
        signal,
        credentials: "same-origin",
        cache: "no-store",
        headers: seoViewerHeaders(
          session?.user.id,
          session?.session.activeOrganizationId,
        ),
      });
      if (!response.ok) throw new Error(`Audit list read ${response.status}`);
      return (await response.json()).audits;
    },
    initialData: serverAudits,
    // The server list is the first read. Polling starts only for an open check.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    enabled: enabled && !!session?.user.id,
    refetchInterval: (state) =>
      state.state.status === "error"
        ? false
        : seoAuditListRefetchMs(state.state.data ?? serverAudits, new Date()),
  });
  return query.data ?? serverAudits;
}
