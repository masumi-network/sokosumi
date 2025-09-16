"use client";

import { useQueryState } from "nuqs";
import { Suspense } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
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
      <DialogContent className="w-svw max-w-xl! border-none bg-transparent p-0 focus:ring-0 focus:outline-none md:w-[80vw] [&>button]:hidden">
        <DialogTitle className="hidden" />
        <DialogDescription className="hidden" />
        <ScrollArea className="max-h-svh md:max-h-[90svh]">
          <CancelCard className="bg-background flex min-h-svh w-svw flex-col rounded-none p-2 md:min-h-auto md:w-auto md:rounded-xl md:p-4" />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
