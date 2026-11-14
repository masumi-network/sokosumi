"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { unmarkTaskArchived } from "@/app/tasks/utils/archived-task-ids";
import { taskHref } from "@/app/tasks/utils/task-href";
import { Button } from "@/components/ui/button";
import { taskClientService } from "@/lib/services/task.client";

interface ArchivedTaskRestoreButtonProps {
  task: { id: string; identifier: string | null; name: string };
}

/** Restores the archived Task on screen and opens it where it lives again. */
export function ArchivedTaskRestoreButton({
  task,
}: ArchivedTaskRestoreButtonProps) {
  const t = useTranslations("App.Tasks.Archived");
  const router = useRouter();
  const [isRestoring, setIsRestoring] = useState(false);

  async function handleRestore() {
    setIsRestoring(true);
    try {
      await taskClientService.restore(task.id);
      unmarkTaskArchived(task.id);
      toast.success(t("restored", { name: task.name }));
      router.replace(taskHref(task));
    } catch {
      toast.error(t("restoreError"));
      setIsRestoring(false);
    }
  }

  return (
    <Button
      className="w-fit shrink-0"
      loading={isRestoring}
      onClick={handleRestore}
    >
      {t("restore")}
    </Button>
  );
}
