"use client";
import type { WorkspaceLabel } from "@sokosumi/core-client";
import { QueryClientContext } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { useWorkspaceTags } from "@/queries/workspace-tags";

interface Catalog {
  organizationId: string | null;
  byId: Map<string, WorkspaceLabel>;
  updatedAt: number;
  vocabularyKey?: string;
  isPending: boolean;
}
const Context = createContext<Catalog | null>(null);

export function useTaskTagCatalog() {
  return useContext(Context);
}

export function TaskTagCatalogProvider({
  organizationId,
  enabled = true,
  children,
}: {
  organizationId: string | null;
  enabled?: boolean;
  children: ReactNode;
}) {
  const inherited = useTaskTagCatalog();
  // Recorded and static previews can render from the Task DTO alone.
  const client = useContext(QueryClientContext);
  if (!enabled) return <Context value={null}>{children}</Context>;
  return client && inherited?.organizationId !== organizationId ? (
    <CachedCatalog organizationId={organizationId}>{children}</CachedCatalog>
  ) : (
    children
  );
}

function CachedCatalog({
  organizationId,
  children,
}: {
  organizationId: string | null;
  children: ReactNode;
}) {
  const { data, dataUpdatedAt, isPending } = useWorkspaceTags(organizationId, {
    includeArchived: true,
  });
  const value = useMemo(() => {
    const byId = new Map<string, WorkspaceLabel>();
    for (const tag of data ?? []) {
      byId.set(tag.id, tag);
      if (tag.taskTopicId && !tag.archived) byId.set(tag.taskTopicId, tag);
    }
    const vocabularyKey =
      data &&
      JSON.stringify(
        [...data]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map(({ id, vocabularyVersion, archived }) => [
            id,
            vocabularyVersion,
            archived,
          ]),
      );
    return {
      organizationId,
      updatedAt: dataUpdatedAt,
      byId,
      vocabularyKey,
      isPending,
    };
  }, [data, dataUpdatedAt, isPending, organizationId]);
  return <Context value={value}>{children}</Context>;
}
