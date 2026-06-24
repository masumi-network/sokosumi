"use client";

import {
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  useDndMonitor,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import { TaskStatus } from "@sokosumi/utils";
import { type CSSProperties, type ReactNode, useRef } from "react";

import type { KanbanColumnId } from "@/lib/types/task";
import { cn } from "@/lib/utils";

/** Columns whose tasks can be dragged. Scheduled is view-only until schedule-on-drop ships. */
const DND_DRAG_COLUMNS = new Set<KanbanColumnId>(["backlog", "todo"]);

/** Columns that accept drops. Scheduled is view-only until schedule-on-drop ships. */
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
    case "scheduled":
      return TaskStatus.QUEUED;
    case "todo":
      return TaskStatus.READY;
    default:
      return null;
  }
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
    <div ref={setNodeRef} style={style} onClickCapture={handleClickCapture}>
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
