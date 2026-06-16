"use client";

import type { JobType, OnChainJobStatus } from "@sokosumi/utils";

import { CopyableValue } from "@/components/copyable-value";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

import {
  JobInputVerificationBadge,
  JobResultVerificationBadge,
} from "./job-verification-badge";

interface HashGroupInputProps {
  direction: "input";
  jobType: JobType;
  identifierFromPurchaser: string | null;
  input: string | null;
}

interface HashGroupResultProps {
  direction: "result";
  jobType: JobType;
  onChainStatus?: OnChainJobStatus | null;
  identifierFromPurchaser: string | null;
  result: string | null;
}

type HashGroupBaseProps = {
  externalHash: string | null;
  hash: string | null;
  tLabelExternal: string;
  tLabelHash: string;
  tMissing: string;
};

export type HashGroupProps =
  | (HashGroupInputProps & HashGroupBaseProps)
  | (HashGroupResultProps & HashGroupBaseProps);

export type HashGroupRowProps = HashGroupProps & {
  label: string;
  rowClassName?: string;
};

export function HashGroupRow({
  label,
  rowClassName = "",
  ...props
}: HashGroupRowProps) {
  const {
    direction,
    externalHash,
    hash,
    tLabelExternal,
    tLabelHash,
    tMissing,
  } = props;
  const bothPresent = Boolean(externalHash) && Boolean(hash);
  const areEqual = bothPresent && externalHash === hash;

  const verificationBadge =
    direction === "input" ? (
      <JobInputVerificationBadge
        direction={direction}
        jobType={props.jobType}
        identifierFromPurchaser={props.identifierFromPurchaser}
        input={props.input ?? ""}
        inputHash={props.externalHash}
      />
    ) : (
      <JobResultVerificationBadge
        direction={direction}
        jobType={props.jobType}
        onChainStatus={props.onChainStatus}
        identifierFromPurchaser={props.identifierFromPurchaser}
        result={props.result}
        resultHash={props.externalHash}
      />
    );

  if (areEqual) {
    return (
      <div
        className={cn(
          `text-muted-foreground flex items-center gap-2 text-xs md:grid-cols-3`,
          rowClassName,
        )}
      >
        <span className="break-all">{label}</span>
        <div className="break-all">
          <div className="flex items-center">
            <CopyableValue value={externalHash} />
            {verificationBadge}
          </div>
        </div>
      </div>
    );
  }

  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value={`${direction}-hash`} className="w-full border-0">
        <AccordionTrigger className="items-center px-0 py-0">
          <div
            className={cn("flex h-9 w-full items-center gap-4", rowClassName)}
          >
            <span className="text-muted-foreground text-xs font-medium break-all md:col-span-1">
              {label}
            </span>
            <div className="text-muted-foreground flex items-center gap-1 text-xs">
              <div>
                <CopyableValue
                  value={externalHash ?? hash}
                  renderButtonAsChild
                  shouldStopPropagation
                />
              </div>
              {verificationBadge}
            </div>
          </div>
        </AccordionTrigger>
        <AccordionContent className="px-0">
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <span className="break-all">{tLabelExternal}</span>
            <div className="break-all">
              {externalHash ? (
                <CopyableValue value={externalHash} />
              ) : (
                <span className="text-destructive inline-flex items-center gap-1">
                  {tMissing}
                </span>
              )}
            </div>
          </div>
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <span className="text-muted-foreground text-xs font-medium break-all">
              {tLabelHash}
            </span>
            <div className="text-xs break-all">
              <CopyableValue value={hash} />
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
