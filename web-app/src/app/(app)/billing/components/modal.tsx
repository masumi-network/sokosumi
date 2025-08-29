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
import { AgentWithCreditsPrice } from "@/lib/db";

interface BillingModalProps {
  randomAgent: AgentWithCreditsPrice | null;
}

export default function BillingModal(props: BillingModalProps) {
  return (
    <Suspense>
      <BillingModalInner {...props} />
    </Suspense>
  );
}

function BillingModalInner({ randomAgent: _randomAgent }: BillingModalProps) {
  const [_sessionId, setSessionId] = useQueryState("session-id");
  const [_cancel, setCancel] = useQueryState("cancel");

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setSessionId(null);
      setCancel(null);
    }
  };

  return (
    <Dialog defaultOpen={true} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogOverlay className="bg-background/50 backdrop-blur-lg md:bg-auto" />
        <DialogContent className="w-svw max-w-3xl! border-none bg-transparent p-0 focus:ring-0 focus:outline-none md:w-[80vw] [&>button]:hidden">
          <DialogTitle className="hidden" />
          <DialogDescription className="hidden" />
          <ScrollArea className="max-h-svh md:max-h-[90svh]"></ScrollArea>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
