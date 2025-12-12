"use client";

import type { Blob, JobWithSokosumiStatus } from "@sokosumi/database";
import { JobStatusWithRelations } from "@sokosumi/database";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import * as z from "zod";

import DefaultErrorBoundary from "@/components/default-error-boundary";
import { FileChip } from "@/components/ui/file-chip";
import { Separator } from "@/components/ui/separator";
import { jobInputSchema, ValidJobInputTypes } from "@/lib/job-input";
import { getInputHash } from "@/lib/utils";
import { isUrlArray, isUrlString } from "@/lib/utils/file";

import { HashGroupRow } from "./hash-group-row";

interface JobDetailsInputsProps {
  job: JobWithSokosumiStatus;
  status: JobStatusWithRelations;
}

export default function JobDetailsInputs({
  job,
  status,
}: JobDetailsInputsProps) {
  return (
    <DefaultErrorBoundary fallback={<JobDetailsInputsError />}>
      <JobDetailsInputsInner job={job} status={status} />
    </DefaultErrorBoundary>
  );
}

function findBlobByUrl(url: string, blobs?: Blob[]): Blob | undefined {
  if (!blobs) return undefined;
  return blobs.find((b) => b.fileUrl === url);
}

function renderInputValue(
  value: unknown,
  type: ValidJobInputTypes,
  blobs?: Blob[],
) {
  if (type === ValidJobInputTypes.FILE) {
    if (isUrlString(value)) {
      const blob = findBlobByUrl(value, blobs);
      return (
        <FileChip url={value} fileName={blob?.fileName} size={blob?.size} />
      );
    }
    if (isUrlArray(value)) {
      if (value.length === 0) return <span>{"-"}</span>;
      return (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {value.map((url) => (
            <FileChip
              key={url}
              url={url}
              fileName={findBlobByUrl(url, blobs)?.fileName}
              size={findBlobByUrl(url, blobs)?.size}
            />
          ))}
        </div>
      );
    }
  }

  return (
    <span className="break-all">
      {typeof value === "object" ? JSON.stringify(value) : String(value)}
    </span>
  );
}

function JobDetailsInputsInner({ job, status }: JobDetailsInputsProps) {
  const inputHash = status.input?.inputHash ?? null;
  const identifierFromPurchaser = job.identifierFromPurchaser ?? null;

  const t = useTranslations("Components.Jobs.JobDetails.Input");
  const tMeta = useTranslations("Components.Jobs.JobDetails.Meta");
  const blobs = status.input?.blobs ?? [];
  const input = status.input?.input ? JSON.parse(status.input.input) : {};
  const inputSchema = status.inputSchema ? JSON.parse(status.inputSchema) : {};

  const calculatedInputHash = useMemo(() => {
    if (!identifierFromPurchaser || !job.input) return null;
    return getInputHash(job.input, identifierFromPurchaser);
  }, [job.input, identifierFromPurchaser]);

  let inputsMap: Record<string, { name: string; type: ValidJobInputTypes }> =
    {};
  if (Array.isArray(inputSchema)) {
    inputsMap = z
      .array(jobInputSchema())
      .parse(inputSchema)
      .reduce(
        (acc, item) => {
          acc[item.id] = { name: item.name, type: item.type };
          return acc;
        },
        {} as Record<string, { name: string; type: ValidJobInputTypes }>,
      );
  }

  const showHashSection = job && (inputHash || calculatedInputHash);

  return (
    <div className="flex flex-col gap-2">
      {Object.keys(input).length > 0 ? (
        <div>
          {Object.entries(input).map(([key, value]) => {
            const label = inputsMap[key]?.name ?? key;
            const type = inputsMap[key]?.type ?? ValidJobInputTypes.NONE;
            return (
              <div
                className="grid grid-cols-1 items-start gap-4 pb-4 text-base md:grid-cols-3"
                key={key}
              >
                <span className="font-bold break-all md:col-span-1">
                  {label}
                </span>
                <div className="break-all md:col-span-2">
                  {renderInputValue(value, type, blobs)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-base">{t("none")}</p>
      )}
      {showHashSection && (
        <>
          <Separator className="my-2" />
          <HashGroupRow
            job={job}
            label={tMeta("inputHash")}
            direction="input"
            onChainHash={inputHash ?? null}
            calculatedHash={calculatedInputHash}
            tLabelOnChain={tMeta("onChain")}
            tLabelCalculated={tMeta("calculated")}
            tMissing={tMeta("missing")}
          />
        </>
      )}
    </div>
  );
}

function JobDetailsInputsError() {
  const t = useTranslations("Components.Jobs.JobDetails.Input");

  return (
    <div className="flex min-h-[120px] w-full items-center justify-center rounded-md border border-red-300 bg-red-50 p-4">
      <span className="text-lg text-red-500">{t("failedToParseInput")}</span>
    </div>
  );
}
