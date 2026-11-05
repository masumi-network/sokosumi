"use client";

import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { useTranslations } from "next-intl";
import type { KeyboardEvent, ReactNode } from "react";

import { cn } from "@/lib/utils";
import { moveIdToSlot } from "@/lib/utils/move-id";

import {
  ChatRoomSidebarRow,
  type ChatRoomSidebarRowProps,
} from "./chat-room-sidebar-row";

interface PinnedRoomsDndContextProps {
  roomIds: string[];
  onReorder: (roomIds: string[]) => void;
  children: ReactNode;
}

/** Drags start on a row's handle only, so the list still scrolls by touch. */
export function PinnedRoomsDndContext({
  roomIds,
  onReorder,
  children,
}: PinnedRoomsDndContextProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over) return;
    const next = moveIdToSlot(roomIds, String(active.id), String(over.id));
    if (next !== roomIds) onReorder(next);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      {children}
    </DndContext>
  );
}

interface SortablePinnedRoomRowProps
  extends Omit<ChatRoomSidebarRowProps, "itemProps" | "reorderHandle"> {
  index: number;
  /** Absent on the first / last row. */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

/**
 * A pinned row in reorder mode. The row's `<li>` is both the dragged row and
 * a drop slot; rows between the drag's start and the slot under it step one
 * row aside, so the gap shows where the drop lands. The handle takes the drag
 * (mouse and touch) and the arrow keys.
 */
export function SortablePinnedRoomRow({
  index,
  onMoveUp,
  onMoveDown,
  ...rowProps
}: SortablePinnedRoomRowProps) {
  const t = useTranslations("App.Channels.Actions");
  const tChannels = useTranslations("App.Channels");
  const roomId = rowProps.room.id;
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

  function handleKeyDown(event: KeyboardEvent) {
    const move =
      event.key === "ArrowUp"
        ? onMoveUp
        : event.key === "ArrowDown"
          ? onMoveDown
          : undefined;
    if (!move) return;
    event.preventDefault();
    move();
  }

  return (
    <ChatRoomSidebarRow
      {...rowProps}
      itemProps={{
        ref(node) {
          setNodeRef(node);
          setDropRef(node);
        },
        style: active
          ? { transform: `translate3d(0, ${Math.round(offsetY)}px, 0)` }
          : undefined,
        className: cn(
          isDragging
            ? "bg-sidebar-accent z-20 rounded-md shadow-md"
            : active && "transition-transform motion-reduce:transition-none",
        ),
      }}
      reorderHandle={
        <button
          type="button"
          {...listeners}
          onKeyDown={handleKeyDown}
          // The link stands down here, so the handle says what it would.
          title={rowProps.workspaceName ?? undefined}
          aria-label={t("reorderHandle", {
            name:
              rowProps.workspaceName == null
                ? rowProps.label
                : `${rowProps.label} ${tChannels("inWorkspace", { workspace: rowProps.workspaceName })}`,
          })}
          className={cn(
            // Same box and 44px touch target as the room menu it stands in for.
            "text-muted-foreground press hover:text-foreground ring-sidebar-ring relative flex size-8 touch-none items-center justify-center rounded-md outline-hidden after:absolute after:-inset-1.5 focus-visible:ring-2 md:size-7 md:after:-inset-0.5",
            isDragging ? "cursor-grabbing" : "cursor-grab",
          )}
        >
          <GripVertical className="size-5 md:size-4" aria-hidden />
        </button>
      }
    />
  );
}
