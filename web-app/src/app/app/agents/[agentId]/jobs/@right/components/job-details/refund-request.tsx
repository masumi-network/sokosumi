"use client";

import { TicketX } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { JobWithStatus } from "@/lib/db";
import { cn } from "@/lib/utils";

interface RequestRefundButtonProps {
  job: JobWithStatus;
  className?: string;
}

export default function RequestRefundButton({
  job,
  className,
}: RequestRefundButtonProps) {
  const t = useTranslations("App.Agents.Jobs.JobDetails.Output");

  return (
    <Button
      variant="ghost"
      onClick={() => console.log("foobar")}
      className={cn(
        "text-muted-foreground flex items-center justify-end gap-2 text-sm",
        className,
      )}
    >
      <TicketX className="h-4 w-4" />
      {t("requestRefund")}
    </Button>
  );
}
