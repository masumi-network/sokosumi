"use client";

import {
  ExternalLink,
  HandCoins,
  LoaderCircle,
  type LucideIcon,
  RefreshCw,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

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
import { useAsyncRouter } from "@/hooks/use-async-router";
import {
  ActionError,
  CommonErrorCode,
  JobErrorCode,
  requestRefundJobByBlockchainIdentifier,
} from "@/lib/actions";
import { JobStatus, JobWithStatus } from "@/lib/db";
import { cn } from "@/lib/utils";

interface RequestRefundButtonProps {
  initialJob: JobWithStatus;
  className?: string;
}

// Status configuration for simple button states
type IntlKey<N extends IntlNestedKey> = Parameters<IntlTranslation<N>>[0];
type RefundIntlKey = IntlKey<"Components.Jobs.JobDetails.Output.Refund">;

interface StatusConfig {
  icon: LucideIcon;
  labelKey: RefundIntlKey;
  isAnimated?: boolean;
}

const STATUS_CONFIGS: Partial<Record<JobStatus, StatusConfig>> = {
  [JobStatus.REFUND_PENDING]: {
    icon: LoaderCircle,
    labelKey: "requested",
    isAnimated: true,
  },
  [JobStatus.DISPUTE_PENDING]: {
    icon: LoaderCircle,
    labelKey: "disputePending",
    isAnimated: true,
  },
  [JobStatus.DISPUTE_RESOLVED]: {
    icon: HandCoins,
    labelKey: "disputeResolved",
  },
  [JobStatus.REFUND_RESOLVED]: {
    icon: HandCoins,
    labelKey: "refunded",
  },
};

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

function RefundErrorButton({
  isLoading,
  onRetry,
  t,
}: {
  isLoading: boolean;
  onRetry: () => void;
  t: IntlTranslation<"Components.Jobs.JobDetails.Output.Refund">;
}) {
  return (
    <button
      className="text-semantic-destructive flex items-center gap-1.5 text-sm transition-opacity hover:opacity-80"
      onClick={onRetry}
      disabled={isLoading}
    >
      {isLoading ? (
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <RefreshCw className="h-3.5 w-3.5" />
      )}
      <span>{t("error")}</span>
    </button>
  );
}

/**
 * Generates the appropriate tooltip title and description for the refund request button
 * based on the job's status and refund eligibility.
 *
 * - For FAILED jobs: Uses the job's `submitResultTime` as the unlock time for refund eligibility.
 *   The tooltip will indicate when the refund becomes available.
 * - For other statuses: Uses the job's `unlockTime` to determine if the refund is available or unavailable,
 *   and formats the tooltip accordingly.
 *
 * @param job - The job object containing status and relevant timestamps.
 * @param t - The translation function for refund-related tooltips.
 * @param formatter - The date formatter for displaying unlock times.
 * @returns An object with `title` and `description` for the tooltip.
 */
function makeTitleAndDescription(
  job: JobWithStatus,
  t: IntlTranslation<"Components.Jobs.JobDetails.Output.Refund">,
  formatter: IntlDateFormatter,
) {
  const isEnabled = isRefundEnabled(job);

  if (job.status === JobStatus.FAILED) {
    // For failed jobs, use submitResultTime as the unlock time for refunds
    const submitResultTimeFormatted = formatter.dateTime(job.submitResultTime, {
      dateStyle: "medium",
      timeStyle: "short",
    });

    return {
      title: t("Tooltip.failed.title"),
      description: t("Tooltip.failed.description", {
        unlockAt: submitResultTimeFormatted,
      }),
    };
  }

  // For other statuses, use unlockTime for available/unavailable tooltips
  const unlockTimeFormatted = formatter.dateTime(job.unlockTime, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  if (!isEnabled) {
    return {
      title: t("Tooltip.unavailable.title"),
      description: t("Tooltip.unavailable.description", {
        unlockAt: unlockTimeFormatted,
      }),
    };
  }

  return {
    title: t("Tooltip.available.title"),
    description: t("Tooltip.available.description", {
      unlockAt: unlockTimeFormatted,
    }),
  };
}

/**
 * Determines if a refund can currently be requested for a given job.
 *
 * Refund eligibility depends on the job's status and timing:
 * - For FAILED jobs: Refund is enabled if the current time is after the job's submitResultTime
 *   and before the unlockTime.
 * - For COMPLETED jobs: Refund is enabled if the current time is before the unlockTime.
 * - For all other statuses: Refund is not enabled.
 *
 * @param job - The job object containing status and relevant timestamps.
 * @returns True if refund is currently enabled, false otherwise.
 */
function isRefundEnabled(job: JobWithStatus): boolean {
  const now = new Date();
  switch (job.status) {
    case JobStatus.FAILED:
      return now > job.submitResultTime && now < job.unlockTime;
    case JobStatus.COMPLETED:
      return now < job.unlockTime;
    default:
      return false;
  }
}

export default function RequestRefundButton({
  initialJob,
  className,
}: RequestRefundButtonProps) {
  const t = useTranslations("Components.Jobs.JobDetails.Output.Refund");
  const router = useAsyncRouter();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ActionError | null>();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const formatter = useFormatter();
  const [job, setJob] = useState(initialJob);

  // Check if status has a simple configuration
  const statusConfig = STATUS_CONFIGS[job.status];
  if (statusConfig) {
    const Icon = statusConfig.icon;
    return (
      <ButtonBase disabled={true} className={className}>
        <Icon
          className={
            statusConfig.isAnimated ? "h-4 w-4 animate-spin" : "h-4 w-4"
          }
        />
        {t(statusConfig.labelKey)}
      </ButtonBase>
    );
  }

  // Handle complex interactive states (default case)
  const { title, description } = makeTitleAndDescription(job, t, formatter);

  const handleRefundRequest = async (job: JobWithStatus) => {
    setIsLoading(true);
    setError(null);

    const result = await requestRefundJobByBlockchainIdentifier({
      blockchainIdentifier: job.blockchainIdentifier,
    });
    if (result.ok) {
      setJob(result.data.job);
    } else {
      switch (result.error.code) {
        case CommonErrorCode.UNAUTHENTICATED:
          toast.error(t("Errors.unauthenticated"), {
            action: {
              label: t("Errors.unauthenticatedAction"),
              onClick: async () => {
                await router.push(`/login`);
              },
            },
          });
          break;
        case JobErrorCode.JOB_NOT_FOUND:
          toast.error(t("Errors.jobNotFound"));
          break;
        case CommonErrorCode.UNAUTHORIZED:
          toast.error(t("Errors.unauthorized"));
          break;
        case CommonErrorCode.INTERNAL_SERVER_ERROR:
          toast.error(t("error"));
          break;
        default:
          toast.error(t("error"));
          break;
      }
      setError(result.error);
    }
    setIsLoading(false);
    setIsDialogOpen(false);
  };

  const handleRetry = () => {
    setError(null);
    setIsDialogOpen(true);
  };

  if (error) {
    return (
      <RefundErrorButton isLoading={isLoading} onRetry={handleRetry} t={t} />
    );
  }

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>
              <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <AlertDialogTrigger asChild>
                  <ButtonBase
                    disabled={isLoading || !isRefundEnabled(job)}
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
                      <span className="mt-2 block">
                        <a
                          href="https://docs.masumi.network/core-concepts/refunds-and-disputes"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary flex items-center gap-1 hover:underline"
                        >
                          {t("learnMore")}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </span>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleRefundRequest(job)}>
                      {t("confirm")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <div className="space-y-1">
              <h4 className="text-sm font-medium">{title}</h4>
              <p className="text-muted-foreground text-xs">{description}</p>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </>
  );
}
