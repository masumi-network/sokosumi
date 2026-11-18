"use client";

import type {
  SaveSeoAuditBriefRequest,
  SeoAuditBrief,
} from "@sokosumi/core-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  SeoWorkspaceLoadError,
  seoLoadErrorStatus,
  seoLoadRecovery,
} from "@/app/seo/seo-load-error-model";
import { saveSeoBriefAction } from "@/lib/actions/seo/save-brief";
import {
  type SeoOwner,
  seoOwnerApiPath,
  seoViewerHeaders,
} from "@/lib/seo/owner";

export function useSeoBrief(
  owner: SeoOwner,
  viewerId: string | undefined,
  organizationId: string | null,
  enabled: boolean,
) {
  const client = useQueryClient();
  const key = ["seo-brief", viewerId, organizationId, owner.kind, owner.id];
  const query = useQuery<SeoAuditBrief>({
    queryKey: key,
    enabled: Boolean(viewerId) && enabled,
    retry: false,
    queryFn: async ({ signal }) => {
      const response = await fetch(`${seoOwnerApiPath(owner)}/brief`, {
        signal,
        cache: "no-store",
        credentials: "same-origin",
        headers: seoViewerHeaders(viewerId, organizationId),
      });
      if (!response.ok) throw new SeoWorkspaceLoadError(response.status);
      return response.json();
    },
  });
  async function save(
    body: SaveSeoAuditBriefRequest,
  ): Promise<"saved" | "conflict" | "error"> {
    if (!viewerId) return "error";
    try {
      const result = await saveSeoBriefAction({
        owner,
        viewerId,
        organizationId,
        body,
      });
      if (!result.ok) return result.error.status === 409 ? "conflict" : "error";
      await client.cancelQueries({ queryKey: key, exact: true });
      client.setQueryData(key, result.value);
      return "saved";
    } catch {
      return "error";
    }
  }
  return {
    data: seoLoadRecovery({ status: seoLoadErrorStatus(query.error) })
      .contextual
      ? undefined
      : query.data,
    invalidate: () => client.invalidateQueries({ queryKey: key, exact: true }),
    error: query.isError,
    reload: query.refetch,
    save,
  };
}
