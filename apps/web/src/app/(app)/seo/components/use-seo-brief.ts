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
import { type BriefPage, SEO_BRIEF_ACTIONS } from "./seo-brief-model";

export function useSeoGoalSuggestion(
  owner: SeoOwner,
  viewerId: string | undefined,
  organizationId: string | null,
  pageId: string | undefined,
) {
  const suggestion = useQuery<BriefPage["action"]>({
    queryKey: [
      "seo-goal-suggestion",
      viewerId,
      organizationId,
      owner.kind,
      owner.id,
      pageId,
    ],
    enabled: Boolean(viewerId && pageId),
    retry: false,
    retryOnMount: false,
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `${seoOwnerApiPath(owner)}/brief/suggestion?pageId=${encodeURIComponent(pageId!)}`,
        {
          signal,
          cache: "no-store",
          credentials: "same-origin",
          headers: seoViewerHeaders(viewerId, organizationId),
        },
      );
      if (!response.ok) return null;
      const value: unknown = (await response.json())?.action;
      return SEO_BRIEF_ACTIONS.find((action) => action === value) ?? null;
    },
  });
  return pageId ? (suggestion.data ?? null) : null;
}

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
  async function saveWithRevision(
    body: SaveSeoAuditBriefRequest,
  ): Promise<number | "conflict" | "error"> {
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
      return result.value.revision;
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
    saveWithRevision,
    save: async (body: SaveSeoAuditBriefRequest) => {
      const result = await saveWithRevision(body);
      return typeof result === "number" ? ("saved" as const) : result;
    },
  };
}
