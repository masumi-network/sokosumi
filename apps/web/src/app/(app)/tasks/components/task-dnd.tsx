"use client";

import {
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  useDndMonitor,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import { type CSSProperties, type ReactNode, useRef } from "react";
import type {
  KanbanColumnId,
  TaskWithCoworker,
} from "@/app/tasks/types/task-board";
import { TaskStatus } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { hasActiveSchedule } from "@/lib/utils/task-schedule";

/** Columns whose tasks can be dragged. */
const DND_DRAG_COLUMNS = new Set<KanbanColumnId>(["backlog", "todo", "done"]);

/** Columns that accept drops. */
const DND_DROP_COLUMNS = new Set<KanbanColumnId>(["backlog", "todo"]);

export interface DragHandleProps {
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  isDragging: boolean;
}

interface DraggableTaskProps {
  id: string;
  columnId: KanbanColumnId;
  children: (props: DragHandleProps) => ReactNode;
}

interface DroppableColumnProps {
  id: KanbanColumnId;
  children: ReactNode;
  className?: string;
}

export function isDnDDragColumn(columnId: KanbanColumnId): boolean {
  return DND_DRAG_COLUMNS.has(columnId);
}

export function isDnDDropColumn(columnId: KanbanColumnId): boolean {
  return DND_DROP_COLUMNS.has(columnId);
}

export function statusForColumn(columnId: KanbanColumnId): TaskStatus | null {
  switch (columnId) {
    case "backlog":
      return TaskStatus.DRAFT;
    case "todo":
      return TaskStatus.READY;
    default:
      return null;
  }
}

/**
 * Whether a task card may start a board/list drag. Terminal done tasks are
 * only draggable when they can reopen to READY (completed/canceled + coworker).
 * Scheduled backlog tasks must not be dragged; clearing the schedule is required first.
 */
export function isTaskDnDDraggable(
  task: Pick<TaskWithCoworker, "status" | "metadata" | "nextRunAt"> & {
    coworker?: { id: string } | null;
  },
): boolean {
  if (
    task.status === TaskStatus.COMPLETED ||
    task.status === TaskStatus.CANCELED
  ) {
    return Boolean(task.coworker?.id);
  }

  if (task.status === TaskStatus.FAILED) {
    return false;
  }

  if (task.status !== TaskStatus.QUEUED) {
    return true;
  }

  return !hasActiveSchedule(
    task.metadata,
    task.nextRunAt ? new Date(task.nextRunAt) : null,
  );
}

export function DraggableTask({ id, columnId, children }: DraggableTaskProps) {
  const justDraggedRef = useRef(false);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id,
      data: { columnId },
    });
  useDndMonitor({
    onDragEnd(event) {
      if (event.active.id === id) {
        justDraggedRef.current = true;
        // Reset the flag after a brief delay to handle cases where the drop
        // occurs over a different element and the click event fires elsewhere
        if (resetTimeoutRef.current) {
          clearTimeout(resetTimeoutRef.current);
        }
        resetTimeoutRef.current = setTimeout(() => {
          justDraggedRef.current = false;
        }, 100);
      }
    },
  });
  const style: CSSProperties = {
    transform:
      transform && !isDragging
        ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
        : undefined,
    position: "relative",
    zIndex: isDragging ? 30 : undefined,
    opacity: isDragging ? 0 : undefined,
    pointerEvents: isDragging ? "none" : undefined,
  };

  const handleClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!justDraggedRef.current) return;
    justDraggedRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-dnd-draggable=""
      onClickCapture={handleClickCapture}
    >
      {children({ attributes, listeners, isDragging })}
    </div>
  );
}

export function DroppableColumn({
  id,
  children,
  className,
}: DroppableColumnProps) {
  const { isOver, setNodeRef } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "z-0 flex h-full min-h-0 flex-col",
        isOver ? "ring-primary/30 rounded-xl ring-2 ring-inset" : null,
        className,
      )}
      data-dnd-column={id}
    >
      {children}
    </div>
  );
}
