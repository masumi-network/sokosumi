"use client";

import { useQueryState } from "nuqs";
import { Suspense } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

import CancelCard from "./cancel-card";

export default function BillingCancelModal() {
  return (
    <Suspense>
      <BillingCancelModalInner />
    </Suspense>
  );
}

function BillingCancelModalInner() {
  const [cancel, setCancel] = useQueryState("cancel");

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setCancel(null);
    }
  };

  return (
    <Dialog open={!!cancel} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogOverlay className="bg-background/50 backdrop-blur-lg md:bg-auto" />
        <DialogContent className="w-[96vw] max-w-3xl! border-none bg-transparent p-4 focus:ring-0 focus:outline-none [&>button]:hidden">
          <DialogTitle className="hidden" />
          <DialogDescription className="hidden" />
          <ScrollArea className="max-h-svh md:max-h-[90svh]">
            <CancelCard />
          </ScrollArea>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
