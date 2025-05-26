"use client";

import { TicketX } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { JobWithStatus } from "@/lib/db";
import { requestRefundJob } from "@/lib/services/job/service";
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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const format = useFormatter();

  const isRefundDisabled = job.unlockTime.getTime() < Date.now();
  const { title, description } = isRefundDisabled
    ? {
        title: t("Tooltip.unavailable.title"),
        description: t("Tooltip.unavailable.description", {
          unlockAt: format.dateTime(job.unlockTime, {
            dateStyle: "medium",
            timeStyle: "short",
          }),
        }),
      }
    : {
        title: t("Tooltip.available.title"),
        description: t("Tooltip.available.description", {
          unlockAt: format.dateTime(job.unlockTime, {
            dateStyle: "medium",
            timeStyle: "short",
          }),
        }),
      };

  const handleClick = async () => {
    if (isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      await requestRefundJob(job.blockchainIdentifier);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const buttonElement = (
    <Button
      variant="ghost"
      onClick={handleClick}
      disabled={isLoading || isRefundDisabled}
      className={cn(
        "text-muted-foreground flex items-center justify-end gap-2 text-sm",
        className,
      )}
    >
      <TicketX className="h-4 w-4" />
      {t("requestRefund")}
    </Button>
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>{buttonElement}</span>
        </TooltipTrigger>
        <TooltipContent>
          <div className="space-y-1">
            <h4 className="text-sm font-medium">{title}</h4>
            <p className="text-muted-foreground text-xs">{description}</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
