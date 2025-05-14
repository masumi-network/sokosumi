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
import { AgentWithRelations, CreditsPrice } from "@/lib/db";

import CreateJobSection from "./create-job-section";

interface CreateJobModalProps {
  agent: AgentWithRelations;
  agentCreditsPrice: CreditsPrice;
}

export default function CreateJobModal(props: CreateJobModalProps) {
  return (
    <Suspense>
      <CreateJobModalInner {...props} />
    </Suspense>
  );
}

function CreateJobModalInner({
  agent,
  agentCreditsPrice,
}: CreateJobModalProps) {
  const [createQuery, setCreateQuery] = useQueryState("create");

  const handleOnOpenChange = (open: boolean) => {
    if (!open) {
      setCreateQuery(null);
    }
  };

  return (
    <Dialog open={createQuery === "true"} onOpenChange={handleOnOpenChange}>
      <DialogPortal>
        <DialogOverlay className="backdrop-blur-lg" />
        <DialogContent className="w-[80vw] max-w-3xl! border-none bg-transparent p-0 focus:ring-0 focus:outline-none [&>button]:hidden">
          <DialogTitle className="hidden" />
          <DialogDescription className="hidden" />
          <ScrollArea className="max-h-[90svh]">
            <CreateJobSection
              agent={agent}
              agentCreditsPrice={agentCreditsPrice}
            />
          </ScrollArea>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
