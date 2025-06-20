"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

import { useCreateJobModalContext } from "./create-job-modal-context";
import CreateJobSection from "./create-job-section";

export default function CreateJobModal() {
  const { open, setOpen, loading, agentWithPrice } = useCreateJobModalContext();

  const handleOnOpenChange = (open: boolean) => {
    if (loading) {
      return;
    }
    setOpen(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOnOpenChange}>
      <DialogPortal>
        <DialogOverlay className="backdrop-blur-lg" />
        <DialogContent className="w-[80vw] max-w-3xl! border-none bg-transparent p-0 focus:ring-0 focus:outline-none [&>button]:hidden">
          <DialogTitle className="hidden" />
          <DialogDescription className="hidden" />
          <ScrollArea className="max-h-[90svh]">
            {agentWithPrice && (
              <CreateJobSection
                agent={agentWithPrice.agent}
                agentCreditsPrice={agentWithPrice.creditsPrice}
              />
            )}
          </ScrollArea>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
