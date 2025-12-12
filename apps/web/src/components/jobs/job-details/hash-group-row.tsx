"use client";

import { JobType, OnChainJobStatus } from "@sokosumi/database";

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
  inputHash: string | null;
}

interface HashGroupResultProps {
  direction: "result";
  jobType: JobType;
  onChainStatus?: OnChainJobStatus | null;
  identifierFromPurchaser: string | null;
  result: string | null;
  resultHash?: string | null;
}

type HashGroupBaseProps = {
  onChainHash: string | null;
  calculatedHash: string | null;
  tLabelOnChain: string;
  tLabelCalculated: string;
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
    onChainHash,
    calculatedHash,
    tLabelOnChain,
    tLabelCalculated,
    tMissing,
  } = props;
  const bothPresent = Boolean(onChainHash) && Boolean(calculatedHash);
  const areEqual = bothPresent && onChainHash === calculatedHash;

  const verificationBadge =
    direction === "input" ? (
      <JobInputVerificationBadge
        direction={direction}
        jobType={props.jobType}
        identifierFromPurchaser={props.identifierFromPurchaser}
        input={props.input ?? ""}
        inputHash={props.inputHash}
      />
    ) : (
      <JobResultVerificationBadge
        direction={direction}
        jobType={props.jobType}
        onChainStatus={props.onChainStatus}
        identifierFromPurchaser={props.identifierFromPurchaser}
        result={props.result}
        resultHash={props.resultHash}
      />
    );

  if (areEqual) {
    return (
      <div
        className={cn(
          `grid h-9 grid-cols-2 items-center gap-4 md:grid-cols-3`,
          rowClassName,
        )}
      >
        <span className="font-bold break-all md:col-span-1">{label}</span>
        <div className="break-all md:col-span-2">
          <div className="flex items-center gap-2">
            <CopyableValue value={onChainHash} />
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
            className={cn(
              "grid h-9 w-full grid-cols-2 items-center gap-4 md:grid-cols-3",
              rowClassName,
            )}
          >
            <span className="font-bold break-all md:col-span-1">{label}</span>
            <div className="flex items-center gap-1">
              <div className="pl-4 md:pl-2.5">
                <CopyableValue
                  value={onChainHash ?? calculatedHash}
                  renderButtonAsChild
                  shouldStopPropagation
                />
              </div>
              {verificationBadge}
            </div>
          </div>
        </AccordionTrigger>
        <AccordionContent className="px-0">
          <div className="grid grid-cols-2 items-center gap-5 text-sm md:grid-cols-3">
            <span className="font-bold break-all md:col-span-1">
              {tLabelOnChain}
            </span>
            <div className="break-all md:col-span-2">
              {onChainHash ? (
                <CopyableValue value={onChainHash} />
              ) : (
                <span className="text-destructive inline-flex items-center gap-1">
                  {tMissing}
                </span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 items-center gap-4 text-sm md:grid-cols-3">
            <span className="font-bold break-all md:col-span-1">
              {tLabelCalculated}
            </span>
            <div className="break-all md:col-span-2">
              <CopyableValue value={calculatedHash} />
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
