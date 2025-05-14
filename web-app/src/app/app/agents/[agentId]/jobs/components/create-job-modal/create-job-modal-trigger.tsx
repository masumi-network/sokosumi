"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AgentWithRelations, CreditsPrice } from "@/lib/db";
import { JobInputsDataSchemaType } from "@/lib/job-input";

import CreateJobSection from "./create-job-section";

interface CreateJobModalTriggerProps {
  agent: AgentWithRelations;
  agentCreditsPrice: CreditsPrice;
  inputSchemaPromise: Promise<JobInputsDataSchemaType>;
}

export default function CreateJobModalTrigger({
  agent,
  agentCreditsPrice,
  inputSchemaPromise,
}: CreateJobModalTriggerProps) {
  const t = useTranslations("App.Agents.Jobs");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleOnOpenChange = (open: boolean) => {
    if (!open && !loading) {
      setOpen(false);
    }
    if (open) {
      setOpen(true);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOnOpenChange}>
      <DialogTrigger asChild>
        <Button variant="primary" className="gap-2">
          <Plus />
          {t("newJob")}
        </Button>
      </DialogTrigger>
      <DialogPortal>
        <DialogOverlay className="backdrop-blur-lg" />
        <DialogContent className="w-[80vw] max-w-3xl! border-none bg-transparent p-0 focus:ring-0 focus:outline-none [&>button]:hidden">
          <DialogTitle className="hidden" />
          <DialogDescription className="hidden" />
          <ScrollArea className="max-h-[90svh]">
            <CreateJobSection
              agent={agent}
              agentCreditsPrice={agentCreditsPrice}
              inputSchemaPromise={inputSchemaPromise}
              loading={loading}
              setLoading={setLoading}
              onClose={() => setOpen(false)}
            />
          </ScrollArea>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
