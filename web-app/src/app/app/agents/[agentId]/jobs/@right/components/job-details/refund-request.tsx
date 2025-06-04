"use client";

import { ExternalLink, HandCoins, LoaderCircle } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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

function ButtonBase({
  disabled,
  onClick,
  children,
  className,
}: {
  disabled: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "text-muted-foreground flex items-center justify-end gap-2 text-sm",
        className,
      )}
    >
      {children}
    </Button>
  );
}

function makeTitleAndDescription(
  isRefundDisabled: boolean,
  unlockTime: Date,
  t: IntlTranslation<"App.Agents.Jobs.JobDetails.Output.Refund">,
  formatter: IntlDateFormatter,
) {
  const unlockTimeFormatted = formatter.dateTime(unlockTime, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const { title, description } = isRefundDisabled
    ? {
        title: t("Tooltip.unavailable.title"),
        description: t("Tooltip.unavailable.description", {
          unlockAt: unlockTimeFormatted,
        }),
      }
    : {
        title: t("Tooltip.available.title"),
        description: t("Tooltip.available.description", {
          unlockAt: unlockTimeFormatted,
        }),
      };

  return { title, description };
}

export default function RequestRefundButton({
  job,
  className,
}: RequestRefundButtonProps) {
  const t = useTranslations("App.Agents.Jobs.JobDetails.Output.Refund");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isRefundRequested, setIsRefundRequested] = useState(
    job.onChainStatus === OnChainJobStatus.REFUND_REQUESTED ||
      job.nextAction === NextJobAction.SET_REFUND_REQUESTED_INITIATED ||
      job.nextAction === NextJobAction.SET_REFUND_REQUESTED_REQUESTED,
  );
  const formatter = useFormatter();

  const isRefunded = job.onChainStatus === OnChainJobStatus.REFUND_WITHDRAWN;
  if (isRefunded) {
    return (
      <ButtonBase disabled={true} className={className}>
        <HandCoins className="h-4 w-4" />
        {t("refunded")}
      </ButtonBase>
    );
  }

  if (isRefundRequested) {
    return (
      <ButtonBase disabled={true} className={className}>
        <LoaderCircle className="h-4 w-4 animate-spin" />
        {t("requested")}
      </ButtonBase>
    );
  }

  const isRefundDisabled = job.unlockTime.getTime() < Date.now();
  const { title, description } = makeTitleAndDescription(
    isRefundDisabled,
    job.unlockTime,
    t,
    formatter,
  );

  const handleRefundRequest = async () => {
    setIsLoading(true);
    setError(null);

    try {
      job = await requestRefundJob(job.blockchainIdentifier);
      setIsRefundRequested(
        job.nextAction === NextJobAction.SET_REFUND_REQUESTED_REQUESTED,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
      setIsDialogOpen(false);
    }
  };

  const buttonElement = (
    <div>
      <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <AlertDialogTrigger asChild>
          <ButtonBase
            disabled={isLoading || isRefundDisabled || isRefundRequested}
            className={className}
          >
            {isLoading ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <HandCoins className="h-4 w-4" />
            )}
            {t("request")}
          </ButtonBase>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirmDescription")}
              <div className="mt-2">
                <a
                  href="https://docs.masumi.network/core-concepts/refunds-and-disputes"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary flex items-center gap-1 hover:underline"
                >
                  {t("learnMore")}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleRefundRequest}>
              {t("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {error && <p className="text-xs text-red-500">{t("error")}</p>}
    </div>
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
