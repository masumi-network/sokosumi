"use client";

import type { Task, TaskListItem } from "@sokosumi/core-client";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { seoImportFiles } from "@/app/seo/seo-import-model";
import { useSession } from "@/lib/auth/auth.client";
import { seoOwnerApiPath, seoViewerHeaders } from "@/lib/seo/owner";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function useSeoImport(model: SeoWorkspaceModel) {
  const t = useTranslations("App.Seo");
  const { data: session } = useSession();
  const [search, setSearch] = useState("");
  const [taskId, setTaskId] = useState("");
  const [fileId, setFileId] = useState("");
  const candidates = useInfiniteQuery({
    queryKey: [
      "seo-import-candidates",
      session?.session.activeOrganizationId,
      session?.user.id,
      model.owner.kind,
      model.owner.id,
      search,
    ],
    enabled: !!session?.user.id,
    initialPageParam: null as string | null,
    queryFn: async ({
      signal,
      pageParam,
    }): Promise<{ tasks: TaskListItem[]; nextCursor: string | null }> => {
      const query = new URLSearchParams({ q: search });
      if (pageParam) query.set("cursor", pageParam);
      const response = await fetch(
        `${seoOwnerApiPath(model.owner)}/imports?${query}`,
        {
          signal,
          credentials: "same-origin",
          cache: "no-store",
          headers: seoViewerHeaders(session?.user.id),
        },
      );
      if (!response.ok) throw new Error("SEO import candidates unavailable");
      return response.json();
    },
    getNextPageParam: (last) => last.nextCursor,
    refetchOnWindowFocus: false,
  });
  const tasks = candidates.data?.pages.flatMap((page) => page.tasks) ?? [];
  const selectedTask = useQuery<Task>({
    queryKey: [
      "seo-import-task",
      session?.session.activeOrganizationId,
      session?.user.id,
      model.owner.kind,
      model.owner.id,
      taskId,
    ],
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `${seoOwnerApiPath(model.owner)}/imports?taskId=${encodeURIComponent(taskId)}`,
        {
          signal,
          credentials: "same-origin",
          cache: "no-store",
          headers: seoViewerHeaders(session?.user.id),
        },
      );
      if (!response.ok) throw new Error("SEO import source unavailable");
      const body: { task: Task } = await response.json();
      return body.task;
    },
    enabled: Boolean(taskId) && !!session?.user.id,
    refetchOnWindowFocus: false,
  });
  const task = selectedTask.data;
  const files = task ? seoImportFiles(task) : [];
  function selectTask(value: string) {
    setTaskId(value);
    setFileId("");
  }
  function changeSearch(value: string) {
    setSearch(value);
    setTaskId("");
    setFileId("");
  }
  async function submit() {
    if (!task || !files.some((file) => file.id === fileId)) return;
    await model.execute(
      { kind: "import_audit", body: { taskId, fileId } },
      t("saved"),
    );
  }
  return {
    candidates,
    selectedTask,
    tasks,
    taskId,
    selectTask,
    files,
    fileId,
    setFileId,
    search,
    changeSearch,
    submit,
  };
}
