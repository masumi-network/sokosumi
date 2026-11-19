"use client";

import {
  type CollisionDetection,
  pointerWithin,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import { GripVertical, MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import type { KeyboardEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface LayoutDragTarget {
  kind: "section" | "feature";
  sectionId: string;
  id: string;
}

export function layoutDragId(target: LayoutDragTarget) {
  return `${target.kind}:${target.id}`;
}

/** Prefer the feature under the pointer to its containing section. */
export const sidebarCollisions: CollisionDetection = (args) => {
  const sectionDrag = args.active.data.current?.kind === "section";
  const hovered = pointerWithin(args);
  const matching = hovered.filter(
    ({ data }) =>
      data?.droppableContainer.data.current?.kind ===
      (sectionDrag ? "section" : "feature"),
  );
  return matching.length || sectionDrag ? matching : hovered;
};

export interface LayoutDragRowProps {
  target: LayoutDragTarget;
  label: string;
  handlePrefix: string;
  onStep: (offset: number) => void;
  onSectionStep?: (offset: number) => void;
  menu: ReactNode;
  preview: ReactNode;
  children?: ReactNode;
}

export function LayoutDragRow({
  target,
  label,
  handlePrefix,
  onStep,
  onSectionStep,
  menu,
  preview,
  children,
}: LayoutDragRowProps) {
  const t = useTranslations("App.Sidebar.Layout");
  const id = layoutDragId(target);
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({ id, data: target });
  const {
    setNodeRef: setDropRef,
    isOver,
    active,
  } = useDroppable({ id, data: target });

  function handleKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      onStep(event.key === "ArrowUp" ? -1 : 1);
    } else if (
      onSectionStep &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      event.preventDefault();
      onSectionStep(event.key === "ArrowLeft" ? -1 : 1);
    }
  }

  return (
    <div
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      className={cn(
        "rounded-md",
        isOver && active?.id !== id && "bg-accent ring-1 ring-ring",
        isDragging && "bg-muted",
      )}
    >
      <div className="flex min-w-0 items-start">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          {...attributes}
          {...listeners}
          id={`${handlePrefix}-${id}`}
          title={t("reorder", { name: label })}
          aria-label={t("reorder", { name: label })}
          aria-describedby={`${handlePrefix}-instructions`}
          className="text-muted-foreground size-11 shrink-0 touch-none cursor-grab active:cursor-grabbing md:size-8"
          onKeyDown={handleKey}
        >
          <GripVertical aria-hidden />
        </Button>
        <div className="min-w-0 flex-1">{preview}</div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-muted-foreground size-11 shrink-0 md:size-8"
              aria-label={t("actions", { name: label })}
            >
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">{menu}</DropdownMenuContent>
        </DropdownMenu>
      </div>
      {children}
    </div>
  );
}
