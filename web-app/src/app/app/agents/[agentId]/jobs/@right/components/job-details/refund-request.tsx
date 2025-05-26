"use client";

import { HandCoins, LoaderCircle } from "lucide-react";
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
import { NextJobAction, OnChainJobStatus } from "@/prisma/generated/client";

interface RequestRefundButtonProps {
  job: JobWithStatus;
  className?: string;
}

export default function RequestRefundButton({
  job,
  className,
}: RequestRefundButtonProps) {
  const t = useTranslations("App.Agents.Jobs.JobDetails.Output.Refund");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRefundRequested, setIsRefundRequested] = useState(
    job.onChainStatus === OnChainJobStatus.REFUND_REQUESTED ||
      job.onChainStatus === OnChainJobStatus.REFUND_WITHDRAWN ||
      job.nextAction === NextJobAction.SET_REFUND_REQUESTED_INITIATED ||
      job.nextAction === NextJobAction.SET_REFUND_REQUESTED_REQUESTED,
  );
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
      setIsRefundRequested(true);
    } catch (err) {
      console.log(err);
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };
  const buttonElement = (
    <div>
      <Button
        variant="ghost"
        onClick={handleClick}
        disabled={isLoading || isRefundDisabled || isRefundRequested}
        className={cn(
          "text-muted-foreground flex items-center justify-end gap-2 text-sm",
          className,
        )}
      >
        {isLoading ? (
          <LoaderCircle className="h-4 w-4 animate-spin" />
        ) : (
          <HandCoins className="h-4 w-4" />
        )}
        {t("request")}
      </Button>
      {error && <p className="text-xs text-red-500">{t("error")}</p>}
    </div>
  );

  if (isRefundRequested) {
    return (
      <Button
        variant="ghost"
        disabled={true}
        className={cn(
          "text-muted-foreground flex items-center justify-end gap-2 text-sm",
          className,
        )}
      >
        <LoaderCircle className="h-4 w-4 animate-spin" />
        {t("requested")}
      </Button>
    );
  }

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
