"use client";

import { LinkIcon } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Fragment, ReactNode, useMemo } from "react";

import { CopyableValue } from "@/components/copyable-value";
import { MiddleTruncate } from "@/components/middle-truncate";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import { getEnvPublicConfig } from "@/config/env.public";
import { convertCentsToCredits, JobWithStatus } from "@/lib/db";
import { JobStatusResponseSchemaType } from "@/lib/schemas";
import {
  cn,
  getInputHash,
  getResultHash,
  toJobInputData,
  tryParseJson,
} from "@/lib/utils";
import { formatDateTimeMedium } from "@/lib/utils/format";
import { buildJobTransactionUrl } from "@/lib/utils/url";

import { JobVerificationBadge } from "./job-verification-badge";

export interface JobMetaDetailsProps {
  job: JobWithStatus;
}

interface HashVerificationResult {
  onChainInputHash: string | null;
  onChainResultHash: string | null;
  calculatedInputHash: string | null;
  calculatedResultHash: string | null;
}

export function JobMetaDetails({ job }: JobMetaDetailsProps) {
  const isMainnet = getEnvPublicConfig().NEXT_PUBLIC_NETWORK === "Mainnet";

  const formatter = useFormatter();
  const t = useTranslations("Components.Jobs.JobDetails.Meta");

  const hashVerification = useMemo<HashVerificationResult>(() => {
    const inputObj = tryParseJson<Record<string, unknown>>(job.input);
    const inputData = inputObj ? toJobInputData(inputObj) : null;
    const outputObj = tryParseJson<JobStatusResponseSchemaType>(job.output);

    const identifier = job.identifierFromPurchaser;
    const calcInput =
      identifier && inputData ? getInputHash(inputData, identifier) : null;
    const calcOutput =
      identifier && outputObj ? getResultHash(outputObj, identifier) : null;

    return {
      onChainInputHash: job.inputHash ?? null,
      onChainResultHash: job.resultHash ?? null,
      calculatedInputHash: calcInput,
      calculatedResultHash: calcOutput,
    };
  }, [job]);

  const {
    onChainInputHash,
    onChainResultHash,
    calculatedInputHash,
    calculatedResultHash,
  } = hashVerification;

  const items = [
    {
      key: "jobId",
      label: t("jobId"),
      rowClassName: "pb-1",
      content: <CopyableValue value={job.agentJobId} />,
    },
    {
      key: "txId",
      label: t("txId"),
      rowClassName: "pb-1",
      content: job.onChainTransactionHash ? (
        <Link
          href={buildJobTransactionUrl(job.onChainTransactionHash, isMainnet)}
          className={"flex items-center gap-1 text-sm md:text-base"}
          target="_blank"
        >
          <LinkIcon className="h-4 w-4" />
          <MiddleTruncate text={job.onChainTransactionHash} />
        </Link>
      ) : (
        <span>{"-"}</span>
      ),
    },
    {
      key: "inputHashGroup",
      label: t("inputHash"),
      rowClassName: "pb-1",
      content: null,
    },
    {
      key: "outputHashGroup",
      label: t("resultHash"),
      rowClassName: "pb-1",
      content: null,
    },
    {
      key: "started",
      label: t("started"),
      rowClassName: "pb-1",
      content: formatDateTimeMedium(formatter.dateTime, job.startedAt),
    },
    {
      key: "finished",
      label: t("finished"),
      rowClassName: "pb-1",
      content: job.completedAt
        ? formatDateTimeMedium(formatter.dateTime, job.completedAt)
        : "-",
    },
    ...(job.creditTransaction
      ? [
          {
            key: "credits",
            label: t("credits"),
            rowClassName: "",
            content: Math.abs(
              convertCentsToCredits(job.creditTransaction.amount),
            ),
          },
        ]
      : []),
  ] as const;

  return (
    <div className="pt-6">
      {items.map((item, index) => {
        const isHashGroup =
          item.key === "inputHashGroup" || item.key === "outputHashGroup";
        if (isHashGroup) {
          const direction = item.key === "inputHashGroup" ? "input" : "output";
          const onChainHash =
            direction === "input" ? onChainInputHash : onChainResultHash;
          const calculatedHash =
            direction === "input" ? calculatedInputHash : calculatedResultHash;
          return (
            <Fragment key={item.key}>
              <HashGroupRow
                label={item.label}
                direction={direction}
                onChainHash={onChainHash}
                calculatedHash={calculatedHash}
                job={job}
                tLabelOnChain={t("onChain")}
                tLabelCalculated={t("calculated")}
                tMissing={t("missing")}
                rowClassName={item.rowClassName}
              />
              {index < items.length - 1 && <Separator className="my-2" />}
            </Fragment>
          );
        }
        return (
          <Fragment key={item.key}>
            <KeyValueRow label={item.label} rowClassName={item.rowClassName}>
              {item.content}
            </KeyValueRow>
            {index < items.length - 1 && <Separator className="my-2" />}
          </Fragment>
        );
      })}
    </div>
  );
}

function KeyValueRow({
  label,
  children,
  rowClassName = "",
}: {
  label: string;
  children: ReactNode;
  rowClassName?: string;
}) {
  return (
    <div
      className={cn(
        `grid h-9 grid-cols-2 items-center gap-4 text-base md:grid-cols-3`,
        rowClassName,
      )}
    >
      <span className="font-bold break-all md:col-span-1">{label}</span>
      <div className="break-all md:col-span-2">{children}</div>
    </div>
  );
}

export default JobMetaDetails;

interface HashGroupProps {
  direction: "input" | "output";
  onChainHash: string | null;
  calculatedHash: string | null;
  job: JobWithStatus;
  tLabelOnChain: string;
  tLabelCalculated: string;
  tMissing: string;
}

interface HashGroupRowProps extends HashGroupProps {
  label: string;
  rowClassName?: string;
}

function HashGroupRow({
  label,
  rowClassName = "",
  ...props
}: HashGroupRowProps) {
  const {
    direction,
    onChainHash,
    calculatedHash,
    job,
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
            <JobVerificationBadge direction={direction} job={job} />
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
              <JobVerificationBadge direction={direction} job={job} />
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
