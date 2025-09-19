"use client";

import { CheckCheck, X } from "lucide-react";
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

  const isVerified = useMemo(() => {
    if (!identifier) return false;
    return isJobVerified(direction, job, identifier);
  }, [direction, job, identifier]);

  const Icon = isVerified ? CheckCheck : X;
  const colorClass = isVerified ? "text-green-500" : "text-red-500";
  const label = isVerified
    ? t("VerificationBadge.verified", { direction: directionText })
    : t("VerificationBadge.unverified", { direction: directionText });

  return (
    <div className="inline-flex items-center pl-4">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-label={label}
            className={cn("inline-flex items-center", className)}
          >
            <Icon className={cn("h-4 w-4", colorClass)} />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <Link
            href={siteConfig.links.mip004Docs}
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
