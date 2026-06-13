"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

interface TaskFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  cancelLabel: string;
  children: React.ReactNode;
  isDismissDisabled?: boolean;
}

export function TaskFormModal({
  open,
  onOpenChange,
  title,
  cancelLabel,
  children,
  isDismissDisabled = false,
}: TaskFormModalProps) {
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isDismissDisabled) return;
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="w-svw max-w-5xl! border-none bg-transparent p-0 focus:ring-0 focus:outline-none md:w-[90vw] [&>button]:hidden"
        onInteractOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogTitle className="hidden" />
        <DialogDescription className="hidden" />
        <div className="bg-background flex h-svh w-svw flex-col overflow-hidden rounded-none md:h-[min(760px,90svh)] md:w-auto md:rounded-xl">
          <div className="flex shrink-0 items-center justify-between px-6 py-4 md:px-8">
            <div className="w-16" />
            <h3 className="text-base font-semibold">{title}</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={isDismissDisabled}
            >
              <span className="text-primary text-sm">{cancelLabel}</span>
            </Button>
          </div>
          <div className="shrink-0 border-t" />
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
