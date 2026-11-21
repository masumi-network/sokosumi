"use client";

import { type ReactNode, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface RoomHeaderPopoverAnchor {
  node: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface RoomHeaderPopoverProps {
  /** The trigger's name and the list's heading. */
  label: string;
  title: string;
  icon: ReactNode;
  testId: string;
  /**
   * Opened from elsewhere (the mobile header's menu): the list anchors on this
   * instead of its own button, and the caller owns `open`. Closing returns
   * focus to the anchor's button.
   */
  anchor?: RoomHeaderPopoverAnchor;
  /** Gets `close`, for a row that jumps away. Mounts only while open. */
  children: (close: () => void) => ReactNode;
  footer?: ReactNode;
}

/** A room header button that opens a list about the room, such as its decisions. */
export function RoomHeaderPopover({
  label,
  title,
  icon,
  testId,
  anchor,
  children,
  footer,
}: RoomHeaderPopoverProps) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = anchor?.open ?? ownOpen;
  const setOpen = anchor?.onOpenChange ?? setOwnOpen;
  const anchorRef = useRef<HTMLDivElement>(null);
  // A trigger's restore skips a close by outside click; match it.
  const interactedOutsideRef = useRef(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {anchor ? (
        <PopoverAnchor ref={anchorRef} className="flex">
          {anchor.node}
        </PopoverAnchor>
      ) : (
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            title={label}
            data-testid={`${testId}-trigger`}
            className="size-10 md:size-8"
          >
            {icon}
          </Button>
        </PopoverTrigger>
      )}
      <PopoverContent
        align="end"
        onInteractOutside={() => {
          interactedOutsideRef.current = true;
        }}
        onCloseAutoFocus={
          anchor
            ? (event) => {
                event.preventDefault();
                if (interactedOutsideRef.current) {
                  interactedOutsideRef.current = false;
                  return;
                }
                anchorRef.current?.querySelector("button")?.focus();
              }
            : undefined
        }
        className="max-h-[min(32rem,70dvh)] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto p-2"
        data-testid={`${testId}-panel`}
      >
        <h2 className="px-2 pt-1 pb-2 text-sm font-semibold">{title}</h2>
        {children(() => setOpen(false))}
        {footer ? (
          <p className="text-muted-foreground px-2 pt-2 text-xs text-pretty">
            {footer}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
