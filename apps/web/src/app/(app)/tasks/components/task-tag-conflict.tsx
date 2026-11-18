"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  loadTaskWorkspaceTags,
  type TaskTagSnapshot,
} from "@/lib/actions/task/load-workspace-tags";

export interface TaskTagConflictProps {
  taskId: string;
  onReload: (tags: TaskTagSnapshot) => void;
}

export function TaskTagConflict({ taskId, onReload }: TaskTagConflictProps) {
  const t = useTranslations("App.Tasks.Tags");
  const [loading, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  function reload() {
    startTransition(async () => {
      setFailed(false);
      try {
        const tags = await loadTaskWorkspaceTags({ taskId });
        if (tags) {
          onReload(tags);
          return;
        }
      } catch {
        // Keep the current draft available if the read fails.
      }
      setFailed(true);
    });
  }
  return (
    <div className="space-y-2">
      <p role="alert" className="text-destructive text-sm">
        {t(failed ? "reloadError" : "conflict")}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        loading={loading}
        onClick={reload}
      >
        {t("reloadTags")}
      </Button>
    </div>
  );
}
