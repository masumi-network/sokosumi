"use client";

import { Share } from "lucide-react";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import { Button } from "@/components/ui/button";
import useModal from "@/hooks/use-modal";
import { cn } from "@/lib/utils";

import { TaskShareModal } from "./task-share-modal";

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
  const { showModal, Component } = useModal(TaskShareModal, {
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
