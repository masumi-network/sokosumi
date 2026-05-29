"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

import { useCreateJobModalContext } from "./create-job-modal-context";
import CreateJobSection from "./create-job-section";

export default function CreateJobModal() {
  const {
    open,
    loading,
    agentWithPrice,
    averageExecutionDuration,
    handleClose,
  } = useCreateJobModalContext();

  const handleOnOpenChange = (open: boolean) => {
    if (loading) {
      return;
    }
    if (!open) {
      handleClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOnOpenChange}>
      <DialogContent className="w-svw max-w-3xl! border-none bg-transparent p-0 focus:ring-0 focus:outline-none md:w-[80vw] [&>button]:hidden">
        <DialogTitle className="hidden" />
        <DialogDescription className="hidden" />
        <ScrollArea className="max-h-svh md:max-h-[90svh]">
          {agentWithPrice && (
            <CreateJobSection
              agent={agentWithPrice}
              averageExecutionDuration={averageExecutionDuration}
            />
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
