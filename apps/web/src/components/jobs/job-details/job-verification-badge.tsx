"use client";

import { JobType, OnChainJobStatus } from "@sokosumi/database";
import {
  type InputVerificationOptions,
  isInputHashVerified,
  isResultHashVerified,
  type ResultVerificationOptions,
} from "@sokosumi/masumi";
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
import { cn } from "@/lib/utils";

interface VerificationState {
  direction: "input" | "result";
  isPending: boolean;
  isVerified: boolean;
  isNotApplicable: boolean;
}

interface JobInputVerificationBadgeProps {
  direction: "input";
  jobType: JobType;
  identifierFromPurchaser: string | null;
  input: string;
  inputHash: string | null;
  className?: string;
}

interface JobResultVerificationBadgeProps {
  direction: "result";
  jobType: JobType;
  onChainStatus?: OnChainJobStatus | null;
  identifierFromPurchaser: string | null;
  result: string | null;
  resultHash?: string | null;
  className?: string;
}

export function JobInputVerificationBadge({
  direction,
  jobType,
  identifierFromPurchaser,
  input,
  inputHash,
  className,
}: JobInputVerificationBadgeProps) {
  const verificationState = useMemo<VerificationState>(() => {
    // For FREE and DEMO jobs without identifier, verification is not applicable
    if (
      !identifierFromPurchaser &&
      (jobType === JobType.DEMO || jobType === JobType.FREE)
    ) {
      return {
        direction,
        isPending: false,
        isVerified: false,
        isNotApplicable: true,
      };
    }

    // For jobs without identifier but not FREE/DEMO, show as unverified
    if (!identifierFromPurchaser) {
      return {
        direction,
        isPending: false,
        isVerified: false,
        isNotApplicable: false,
      };
    }

    const inputVerificationOptions: InputVerificationOptions = {
      identifierFromPurchaser,
      inputHash,
      input,
    };

    return {
      direction,
      isPending: false,
      isVerified: isInputHashVerified(inputVerificationOptions),
      isNotApplicable: false,
    };
  }, [direction, identifierFromPurchaser, inputHash, input, jobType]);

  return (
    <JobVerificationBadgeBase {...verificationState} className={className} />
  );
}

export function JobResultVerificationBadge({
  direction,
  jobType,
  onChainStatus,
  identifierFromPurchaser,
  result,
  resultHash,
  className,
}: JobResultVerificationBadgeProps) {
  const verificationState = useMemo<VerificationState>(() => {
    // For FREE and DEMO jobs without identifier, verification is not applicable
    if (
      !identifierFromPurchaser &&
      (jobType === JobType.DEMO || jobType === JobType.FREE)
    ) {
      return {
        direction,
        isPending: false,
        isVerified: false,
        isNotApplicable: true,
      };
    }

    // For jobs without identifier but not FREE/DEMO, show as unverified
    if (!identifierFromPurchaser) {
      return {
        direction,
        isPending: false,
        isVerified: false,
        isNotApplicable: false,
      };
    }

    // Direction: output → pending only when on-chain state is FUNDS_LOCKED
    // Otherwise, try to verify the hash
    const isFundsLocked = onChainStatus === OnChainJobStatus.FUNDS_LOCKED;
    if (isFundsLocked) {
      return {
        direction,
        isPending: true,
        isVerified: false,
        isNotApplicable: false,
      };
    } else {
      const resultVerificationOptions: ResultVerificationOptions = {
        identifierFromPurchaser,
        resultHash: resultHash ?? null,
        result,
      };

      return {
        direction,
        isPending: false,
        isVerified: isResultHashVerified(resultVerificationOptions),
        isNotApplicable: false,
      };
    }
  }, [
    direction,
    onChainStatus,
    identifierFromPurchaser,
    resultHash,
    result,
    jobType,
  ]);

  return (
    <JobVerificationBadgeBase {...verificationState} className={className} />
  );
}

function JobVerificationBadgeBase({
  direction,
  isPending,
  isVerified,
  isNotApplicable,
  className,
}: VerificationState & { className?: string }) {
  const t = useTranslations("Components.Jobs.JobDetails");

  const directionText =
    direction === "input" ? t("Input.title") : t("Output.result");

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
