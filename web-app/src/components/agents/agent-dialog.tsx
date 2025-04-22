"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AgentWithRelations, CreditsPrice, getAgentName } from "@/lib/db";

interface AgentDialogProps {
  children: React.ReactNode;
  agent: AgentWithRelations;
  creditsPrice: CreditsPrice;
}

export default function AgentDialog({
  children,
  agent,
  creditsPrice,
}: AgentDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{getAgentName(agent)}</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          <p>{creditsPrice.cents}</p>
        </DialogDescription>
      </DialogContent>
    </Dialog>
  );
}
