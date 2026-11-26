"use client";

import type { SeoAuditSummary } from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/auth/auth.client";
import { seoViewerHeaders } from "@/lib/seo/owner";
import { collectCursorPages } from "@/lib/utils/collect-cursor-pages";
import {
  SEO_AUDIT_LIST_PAGE_MAX,
  seoAuditListRefetchMs,
} from "./seo-audit-status";

type AuditListScope = {
  projectId: string | null;
  archived: boolean;
  cursor: string | null;
  /** The rows are a ranked search: keep their order, refresh each one. */
  searching: boolean;
};

export type SeoAuditListPage = {
  audits: SeoAuditSummary[];
  nextCursor: string | null;
};

/** A read the viewer may no longer make (signed out, other workspace): polling stops. */
const AUTHORIZATION_STATUSES = new Set([401, 403, 409]);

class AuditListReadError extends Error {
  constructor(readonly status: number) {
    super(`Audit list read ${status}`);
  }
}

/**
 * The Audit list the server rendered, read again while a check is open. The server list sits in a cache, so a
 * page refresh cannot be trusted to bring the new status; this reads only the list. Rows and the next-page cursor
 * come from the same read, so a new row on top never makes the More link skip one.
 */
export function useSeoAuditList(
  server: SeoAuditListPage,
  { projectId, archived, cursor, searching }: AuditListScope,
): SeoAuditListPage {
  const { data: session } = useSession();
  const read = async (
    pageCursor: string | null,
    signal: AbortSignal,
    limit?: number,
  ): Promise<SeoAuditListPage> => {
    const search = new URLSearchParams();
    if (projectId) search.set("projectId", projectId);
    if (archived) search.set("status", "archived");
    if (pageCursor) search.set("cursor", pageCursor);
    if (limit) search.set("limit", String(limit));
    const response = await fetch(`/api/seo/audits?${search}`, {
      signal,
      credentials: "same-origin",
      cache: "no-store",
      headers: seoViewerHeaders(
        session?.user.id,
        session?.session.activeOrganizationId,
      ),
    });
    if (!response.ok) throw new AuditListReadError(response.status);
    const body = await response.json();
    return {
      audits: body.audits,
      nextCursor: body.pagination?.nextCursor ?? null,
    };
  };
  const query = useQuery({
    // A new server list (after an archive, say) is a new entry, so a cached poll never hides it.
    queryKey: [
      "seo-audit-list",
      session?.session.activeOrganizationId,
      session?.user.id,
      projectId,
      archived,
      cursor,
      searching,
      server.audits,
      server.nextCursor,
    ],
    queryFn: async ({ signal }): Promise<SeoAuditListPage> => {
      if (!searching) return read(cursor, signal);
      // The search ranked every Audit on the server: read them all in the largest pages, show the same rows in
      // the same order. A row the read no longer returns (archived, deleted) leaves the list.
      const first = await read(null, signal, SEO_AUDIT_LIST_PAGE_MAX);
      const all = await collectCursorPages(
        first.audits,
        first.nextCursor,
        async (pageCursor) => {
          const page = await read(pageCursor, signal, SEO_AUDIT_LIST_PAGE_MAX);
          return { items: page.audits, nextCursor: page.nextCursor };
        },
      );
      const byId = new Map(all.map((audit) => [audit.id, audit]));
      return {
        audits: server.audits.flatMap((audit) => byId.get(audit.id) ?? []),
        nextCursor: server.nextCursor,
      };
    },
    initialData: server,
    // The server list is the first read. Polling starts only for an open check.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    enabled: !!session?.user.id,
    // A failed read keeps the last rows and reads again while their check is open; the check's own age ends it.
    refetchInterval: (state) =>
      state.state.error instanceof AuditListReadError &&
      AUTHORIZATION_STATUSES.has(state.state.error.status)
        ? false
        : seoAuditListRefetchMs(
            (state.state.data ?? server).audits,
            new Date(),
          ),
  });
  return query.data ?? server;
}
