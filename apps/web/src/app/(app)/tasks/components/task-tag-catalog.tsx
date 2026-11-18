"use client";
import type { TaskTagId, WorkspaceLabel } from "@sokosumi/core-client";
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

export function representedTaskTopics(
  catalog: Catalog | null,
  workspaceTags: readonly Pick<WorkspaceLabel, "id" | "taskTopicId">[],
): Set<TaskTagId> {
  const topics = new Set<TaskTagId>();
  for (const tag of workspaceTags) {
    const latest = catalog?.byId.get(tag.id);
    const topic = latest ? latest.taskTopicId : tag.taskTopicId;
    if (topic) topics.add(topic);
  }
  return topics;
}

/** A selected workspace label can represent a built-in topic; custom homonyms keep their own badge. */
export function useVisibleTaskTopicIds(
  topicIds: readonly TaskTagId[],
  selectedWorkspaceTags: readonly Pick<WorkspaceLabel, "id" | "taskTopicId">[],
): TaskTagId[] {
  const catalog = useTaskTagCatalog();
  const selectedTopics = representedTaskTopics(catalog, selectedWorkspaceTags);
  return topicIds.filter((id) => !selectedTopics.has(id));
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
