"use client";

import { CheckCheck, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { siteConfig } from "@/config/site";
import type { JobWithStatus } from "@/lib/db";
import { cn, isJobVerified } from "@/lib/utils";

interface VerificationState {
  isPending: boolean;
  isVerified: boolean;
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

  const identifier = job.identifierFromPurchaser;

  const verificationState = useMemo<VerificationState>(() => {
    if (!identifier) {
      return { isPending: false, isVerified: false };
    }
    const verified = isJobVerified(direction, job, identifier);
    const pending =
      direction === "output" && job.resultSubmittedAt == null && !verified;
    return { isPending: pending, isVerified: verified };
  }, [direction, job, identifier]);

  const { isPending, isVerified } = verificationState;

  const Icon = isPending ? Loader2 : isVerified ? CheckCheck : X;
  const colorClass = isPending
    ? "text-primary"
    : isVerified
      ? "text-green-500"
      : "text-red-500";
  const label = isPending
    ? t("VerificationBadge.pending", { direction: directionText })
    : isVerified
      ? t("VerificationBadge.verified", { direction: directionText })
      : t("VerificationBadge.unverified", { direction: directionText });

  return (
    <div className="inline-flex items-center pl-4">
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
    </div>
  );
}
