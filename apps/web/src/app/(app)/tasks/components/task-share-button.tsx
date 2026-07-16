"use client";

import { Share } from "lucide-react";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import { Button } from "@/components/ui/button";
import useModal from "@/hooks/use-modal";
import type { TaskShare } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

import { TaskShareModal } from "./task-share-modal";

interface TaskShareModalHostProps {
  open: boolean;
  onOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  taskId: string;
  share: TaskShare | null;
}

/**
 * useModal renders its first argument as the modal component type. Passing an
 * inline render prop there creates a fresh component type every render, so
 * React remounts TaskShareModal and re-runs useState(share) from a potentially
 * stale RSC prop before router.refresh() finishes. Keep the host component
 * stable and pass changing task props separately through the hook.
 */
function TaskShareModalHost({
  open,
  onOpenChange,
  taskId,
  share,
}: TaskShareModalHostProps) {
  return (
    <TaskShareModal
      open={open}
      onOpenChange={onOpenChange}
      taskId={taskId}
      share={share}
    />
  );
}

interface TaskShareButtonProps {
  task: Pick<TaskWithCoworker, "id" | "share">;
  label: string;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
}

export function TaskShareButton({
  task,
  label,
  className,
  variant = "ghost",
  size = "icon",
}: TaskShareButtonProps) {
  const { showModal, Component } = useModal(TaskShareModalHost, {
    taskId: task.id,
    share: task.share ?? null,
  });

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={showModal}
        className={cn(className)}
        title={label}
        aria-label={label}
      >
        <Share className="size-4" />
      </Button>
      {Component}
    </>
  );
}
