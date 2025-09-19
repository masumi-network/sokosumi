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
import type { JobStatusResponseSchemaType } from "@/lib/schemas";
import { cn, getMatchedHash, toJobInputData, tryParseJson } from "@/lib/utils";

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

  const isJobVerified = (
    direction: "input" | "output",
    job: JobWithStatus,
    identifier: string,
  ): boolean => {
    // input
    if (direction === "input") {
      if (!job.inputHash) return false;
      const inputObj = tryParseJson<Record<string, unknown>>(job.input);
      const inputData = inputObj ? toJobInputData(inputObj) : null;
      if (!inputData) return false;
      const matched = getMatchedHash(
        "input",
        inputData,
        identifier,
        job.inputHash,
      );
      return matched !== null;
    }
    // output
    if (!job.outputHash) return false;
    const outputObj = tryParseJson<JobStatusResponseSchemaType>(job.output);
    if (!outputObj) return false;
    const matched = getMatchedHash(
      "output",
      outputObj,
      identifier,
      job.outputHash,
    );
    return matched !== null;
  };

  const isVerified = useMemo(() => {
    if (!identifier) return false;
    return isJobVerified(direction, job, identifier);
  }, [direction, job, identifier]);

  const Icon = isVerified ? CheckCheck : X;
  const colorClass = isVerified ? "text-green-500" : "text-red-500";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={
            isVerified
              ? t("VerificationBadge.verifiedAria", {
                  direction: directionText,
                })
              : t("VerificationBadge.unverifiedAria", {
                  direction: directionText,
                })
          }
          className={cn("inline-flex items-center pl-4", className)}
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
          {t("VerificationBadge.tooltip", { direction: directionText })}
        </Link>
      </TooltipContent>
    </Tooltip>
  );
}
