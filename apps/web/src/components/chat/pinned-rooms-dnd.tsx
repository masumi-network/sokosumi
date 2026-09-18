"use client";

import {
  DndContext,
  type DragEndEvent,
  MouseSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

import {
  ChatRoomSidebarRow,
  type ChatRoomSidebarRowProps,
} from "./chat-room-sidebar-row";

/** `ids` with `activeId` moved to the slot `overId` holds. */
export function movePinnedRoomId(
  ids: string[],
  activeId: string,
  overId: string,
): string[] {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1 || from === to) {
    return ids;
  }
  const next = ids.filter((id) => id !== activeId);
  next.splice(to, 0, activeId);
  return next;
}

interface PinnedRoomsDndContextProps {
  roomIds: string[];
  onReorder: (roomIds: string[]) => void;
  children: ReactNode;
}

/**
 * Mouse only. A touch drag would fight the sidebar's own scroll and the
 * link's long-press, so touch and keyboard reorder from the row menu.
 */
export function PinnedRoomsDndContext({
  roomIds,
  onReorder,
  children,
}: PinnedRoomsDndContextProps) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
  );

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over) return;
    const next = movePinnedRoomId(roomIds, String(active.id), String(over.id));
    if (next !== roomIds) onReorder(next);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      {children}
    </DndContext>
  );
}

/**
 * Props for the row's `<li>`: makes it both the dragged row and a drop slot.
 * Rows between the drag's start and the slot under it step one row aside, so
 * the gap shows where the drop lands.
 */
function usePinnedRoomSortable(
  roomId: string,
  index: number,
): ComponentProps<"li"> {
  const { listeners, setNodeRef, transform, isDragging, active, over } =
    useDraggable({ id: roomId, data: { index } });
  const { setNodeRef: setDropRef } = useDroppable({
    id: roomId,
    data: { index },
  });

  const from: unknown = active?.data.current?.index;
  const to: unknown = over?.data.current?.index;
  const rowHeight = active?.rect.current.initial?.height ?? 0;
  let offsetY = 0;
  if (isDragging) {
    offsetY = transform?.y ?? 0;
  } else if (typeof from === "number" && typeof to === "number") {
    if (from < index && index <= to) offsetY = -rowHeight;
    if (to <= index && index < from) offsetY = rowHeight;
  }

  return {
    // React events bubble out of the row menu's portal; only a press on the
    // row itself may start a drag.
    onMouseDown(event) {
      if (
        event.target instanceof Node &&
        event.currentTarget.contains(event.target)
      ) {
        listeners?.onMouseDown?.(event);
      }
    },
    ref(node) {
      setNodeRef(node);
      setDropRef(node);
    },
    style: active
      ? {
          transform: `translate3d(0, ${Math.round(offsetY)}px, 0)`,
          // Without this the mouse-up lands on the link and the browser
          // follows it: dnd-kit only stops the click reaching React.
          pointerEvents: isDragging ? "none" : undefined,
        }
      : undefined,
    className: cn(
      isDragging
        ? "bg-sidebar-accent z-20 rounded-md shadow-md"
        : active && "transition-transform motion-reduce:transition-none",
    ),
  };
}

interface SortablePinnedRoomRowProps
  extends Omit<ChatRoomSidebarRowProps, "itemProps"> {
  index: number;
}

export function SortablePinnedRoomRow({
  index,
  ...rowProps
}: SortablePinnedRoomRowProps) {
  const itemProps = usePinnedRoomSortable(rowProps.room.id, index);
  return <ChatRoomSidebarRow {...rowProps} itemProps={itemProps} />;
}
