"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

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
      <DialogContent className="w-svw max-w-3xl! border-none bg-transparent p-0 focus:ring-0 focus:outline-none md:w-[80vw] [&>button]:hidden">
        <DialogTitle className="hidden" />
        <DialogDescription className="hidden" />
        <ScrollArea className="max-h-svh md:max-h-[90svh]">
          <div className="bg-background flex min-h-svh w-svw flex-col rounded-none md:min-h-auto md:w-auto md:rounded-xl">
            <div className="flex items-center justify-between px-6 py-4">
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
            <div className="border-t" />
            {children}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
