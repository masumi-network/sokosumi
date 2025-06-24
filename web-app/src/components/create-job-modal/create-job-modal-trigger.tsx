"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useCreateJobModalContext } from "./create-job-modal-context";

interface CreateJobModalTriggerProps {
  agentId: string;
  className?: string | undefined;
}

export default function CreateJobModalTrigger({
  agentId,
  className,
}: CreateJobModalTriggerProps) {
  const t = useTranslations("App.Agents.Jobs");
  const { handleOpen } = useCreateJobModalContext();

  const handleClick = () => {
    handleOpen(agentId);
  };

  return (
    <Button
      variant="primary"
      className={cn("gap-2", className)}
      onClick={handleClick}
    >
      <Plus />
      {t("newJob")}
    </Button>
  );
}
