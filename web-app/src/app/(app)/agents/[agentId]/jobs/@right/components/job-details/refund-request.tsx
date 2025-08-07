"use client";

import { ExternalLink, HandCoins, LoaderCircle } from "lucide-react";
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
  job: JobWithStatus,
  t: IntlTranslation<"App.Agents.Jobs.JobDetails.Output.Refund">,
  formatter: IntlDateFormatter,
) {
  const isEnabled = isRefundEnabled(job);
  if (job.status === JobStatus.FAILED) {
    // Use submitResultTime for failed jobs (automatic refund timing)
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

  // Use unlockTime for available/unavailable states
  const unlockTimeFormatted = formatter.dateTime(job.unlockTime, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const { title, description } = !isEnabled
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

function isRefundEnabled(job: JobWithStatus) {
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
  const t = useTranslations("App.Agents.Jobs.JobDetails.Output.Refund");
  const router = useAsyncRouter();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const formatter = useFormatter();
  const [job, setJob] = useState(initialJob);

  switch (job.status) {
    case JobStatus.REFUND_PENDING:
      return (
        <ButtonBase disabled={true} className={className}>
          <LoaderCircle className="h-4 w-4 animate-spin" />
          {t("requested")}
        </ButtonBase>
      );
    case JobStatus.REFUND_RESOLVED:
      return (
        <ButtonBase disabled={true} className={className}>
          <HandCoins className="h-4 w-4" />
          {t("refunded")}
        </ButtonBase>
      );
    default:
      const { title, description } = makeTitleAndDescription(job, t, formatter);

      const handleRefundRequest = async (job: JobWithStatus) => {
        setIsLoading(true);
        setError(null);

        const result = await requestRefundJobByBlockchainIdentifier(
          job.blockchainIdentifier,
        );
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
          }
          setError(result.error);
        }
        setIsLoading(false);
        setIsDialogOpen(false);
      };

      return (
        <>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <AlertDialog
                    open={isDialogOpen}
                    onOpenChange={setIsDialogOpen}
                  >
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
                        <AlertDialogAction
                          onClick={() => handleRefundRequest(job)}
                        >
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
          {error && (
            <p className="text-semantic-destructive text-xs">{t("error")}</p>
          )}
        </>
      );
  }
}
