"use client";

import { MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface UnreadThreadsPanelLabels {
  open: string;
}

interface UnreadThreadsPanelProps {
  labels: UnreadThreadsPanelLabels;
  isOpen: boolean;
  onToggle: () => void;
}

export function UnreadThreadsPanel({
  labels,
  isOpen,
  onToggle,
}: UnreadThreadsPanelProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={labels.open}
      aria-expanded={isOpen}
      data-testid="unread-threads-trigger"
      className="relative size-8"
      onClick={onToggle}
    >
      <MessagesSquare className="size-4" />
    </Button>
  );
}
