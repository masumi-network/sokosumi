"use client";

import { AlertCircle, CheckCheck, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { siteConfig } from "@/config/site";
import { isDemoJob, isFreeJob, type JobWithStatus } from "@/lib/db";
import { cn, isJobVerified } from "@/lib/utils";
import { OnChainJobStatus } from "@/prisma/generated/client";

interface VerificationState {
  isPending: boolean;
  isVerified: boolean;
  isNotApplicable: boolean;
}

interface JobVerificationBadgeProps {
  direction: "input" | "output";
  job: JobWithStatus;
  className?: string;
}

export function JobVerificationBadge({
  direction,
  job,
  className,
}: JobVerificationBadgeProps) {
  const t = useTranslations("Components.Jobs.JobDetails");

  const directionText =
    direction === "input" ? t("Input.title") : t("Output.title");

  const verificationState = useMemo<VerificationState>(() => {
    // For FREE and DEMO jobs without identifier, verification is not applicable
    if (!job.identifierFromPurchaser && (isDemoJob(job) || isFreeJob(job))) {
      return { isPending: false, isVerified: false, isNotApplicable: true };
    }

    // For jobs without identifier but not FREE/DEMO, show as unverified
    if (!job.identifierFromPurchaser) {
      return { isPending: false, isVerified: false, isNotApplicable: false };
    }

    switch (direction) {
      case "output":
        // Direction: output → pending only when on-chain state is FUNDS_LOCKED
        // Otherwise, try to verify the hash
        const isFundsLocked =
          job.onChainStatus === OnChainJobStatus.FUNDS_LOCKED;
        if (isFundsLocked) {
          return { isPending: true, isVerified: false, isNotApplicable: false };
        } else {
          return {
            isPending: false,
            isVerified: isJobVerified("output", job),
            isNotApplicable: false,
          };
        }
      case "input":
        return {
          isPending: false,
          isVerified: isJobVerified("input", job),
          isNotApplicable: false,
        };
      default:
        return { isPending: false, isVerified: false, isNotApplicable: false };
    }
  }, [direction, job]);

  const { isPending, isVerified, isNotApplicable } = verificationState;

  const Icon = isPending
    ? Loader2
    : isNotApplicable
      ? AlertCircle
      : isVerified
        ? CheckCheck
        : X;
  const colorClass = isPending
    ? "text-primary"
    : isNotApplicable
      ? "text-muted-foreground"
      : isVerified
        ? "text-semantic-success"
        : "text-semantic-destructive";
  const label = isPending
    ? t("VerificationBadge.pending", { direction: directionText })
    : isNotApplicable
      ? t("VerificationBadge.notApplicable", { direction: directionText })
      : isVerified
        ? t("VerificationBadge.verified", { direction: directionText })
        : t("VerificationBadge.unverified", { direction: directionText });

  return (
    <span className="inline-flex items-center pl-4">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-label={label}
            className={cn("inline-flex items-center", className)}
            aria-busy={isPending}
          >
            <Icon
              className={cn(
                "h-4 w-4",
                colorClass,
                isPending ? "animate-spin" : undefined,
              )}
            />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <Link
            href={siteConfig.links.decisionLoggingDocs}
            target="_blank"
            rel="noreferrer noopener"
          >
            {label}
          </Link>
        </TooltipContent>
      </Tooltip>
    </span>
  );
}
