"use client";

import { JobWithStatus } from "@sokosumi/database";

import { CopyableValue } from "@/components/copyable-value";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

import { JobVerificationBadge } from "./job-verification-badge";

export interface HashGroupProps {
  direction: "input" | "result";
  onChainHash: string | null;
  calculatedHash: string | null;
  data: JobWithStatus;
  tLabelOnChain: string;
  tLabelCalculated: string;
  tMissing: string;
}

export interface HashGroupRowProps extends HashGroupProps {
  label: string;
  rowClassName?: string;
}

export function HashGroupRow({
  label,
  rowClassName = "",
  ...props
}: HashGroupRowProps) {
  const {
    direction,
    onChainHash,
    calculatedHash,
    data,
    tLabelOnChain,
    tLabelCalculated,
    tMissing,
  } = props;
  const bothPresent = Boolean(onChainHash) && Boolean(calculatedHash);
  const areEqual = bothPresent && onChainHash === calculatedHash;

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
            <JobVerificationBadge direction={direction} data={data} />
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
              <JobVerificationBadge direction={direction} data={data} />
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
