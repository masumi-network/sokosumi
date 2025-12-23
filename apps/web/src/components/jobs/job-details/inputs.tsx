"use client";

import type { Blob } from "@sokosumi/database";
import { JobType } from "@sokosumi/database";
import { hashInput } from "@sokosumi/masumi";
import { InputFieldSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import DefaultErrorBoundary from "@/components/default-error-boundary";
import { FileChip } from "@/components/ui/file-chip";
import { Separator } from "@/components/ui/separator";
import {
  flattenInputs,
  normalizeAndValidateInputSchema,
} from "@/lib/schemas/job";
import { isUrlArray, isUrlString } from "@/lib/utils/file";

import { HashGroupRow } from "./hash-group-row";

interface JobDetailsInputsProps {
  input: string | null;
  inputSchema: string | null;
  blobs?: Blob[];
  inputHash?: string | null;
  identifierFromPurchaser?: string | null;
  jobType?: JobType;
}

export default function JobDetailsInputs({
  input,
  inputSchema,
  blobs,
  inputHash,
  identifierFromPurchaser,
  jobType,
}: JobDetailsInputsProps) {
  return (
    <DefaultErrorBoundary fallback={<JobDetailsInputsError />}>
      <JobDetailsInputsInner
        input={input}
        inputSchema={inputSchema}
        blobs={blobs}
        inputHash={inputHash}
        identifierFromPurchaser={identifierFromPurchaser}
        jobType={jobType}
      />
    </DefaultErrorBoundary>
  );
}

function findBlobByUrl(url: string, blobs?: Blob[]): Blob | undefined {
  if (!blobs) return undefined;
  return blobs.find((b) => b.fileUrl === url);
}

function isOption(type: InputType): boolean {
  return (
    type === InputType.OPTION ||
    type === InputType.RADIO_GROUP ||
    type === InputType.MULTISELECT
  );
}

function extractOptionValues(item: InputFieldSchemaType): string[] | undefined {
  if (
    item.type === InputType.OPTION ||
    item.type === InputType.RADIO_GROUP ||
    item.type === InputType.MULTISELECT
  ) {
    return item.data.values;
  }
  return undefined;
}

function mapIndexToLabel(index: unknown, values: string[]): string {
  if (
    typeof index === "number" &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < values.length
  ) {
    return values[index];
  }
  return String(index);
}

function renderInputValue(
  value: unknown,
  type: InputType,
  blobs?: Blob[],
  values?: string[],
) {
  if (type === InputType.FILE) {
    if (isUrlString(value)) {
      const blob = findBlobByUrl(value, blobs);
      return (
        <FileChip url={value} fileName={blob?.fileName} size={blob?.size} />
      );
    }
    if (isUrlArray(value)) {
      if (value.length === 0) {
        return <span>{"-"}</span>;
      }
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

  if (isOption(type) && values && values.length > 0) {
    if (typeof value === "number") {
      return (
        <span className="break-all">{mapIndexToLabel(value, values)}</span>
      );
    }

    if (Array.isArray(value)) {
      const labels = value
        .filter(
          (v): v is number =>
            typeof v === "number" &&
            Number.isInteger(v) &&
            v >= 0 &&
            v < values.length,
        )
        .map((index) => mapIndexToLabel(index, values));
      return <span className="break-all">{labels.join(", ")}</span>;
    }

    if (typeof value === "string") {
      return <span className="break-all">{value}</span>;
    }
  }

  return (
    <span className="break-all">
      {typeof value === "object" ? JSON.stringify(value) : String(value)}
    </span>
  );
}

function JobDetailsInputsInner({
  input: rawInput,
  inputSchema: rawInputSchema,
  blobs = [],
  inputHash = null,
  identifierFromPurchaser = null,
  jobType,
}: JobDetailsInputsProps) {
  const t = useTranslations("Components.Jobs.JobDetails.Input");
  const tMeta = useTranslations("Components.Jobs.JobDetails.Meta");

  const input = rawInput ? JSON.parse(rawInput) : {};

  const calculatedInputHash = useMemo(() => {
    if (!identifierFromPurchaser || !rawInput) return null;
    return hashInput(rawInput, identifierFromPurchaser);
  }, [identifierFromPurchaser, rawInput]);

  const inputsMap: Record<
    string,
    { name: string; type: InputType; values?: string[] }
  > = useMemo(() => {
    if (!rawInputSchema) return {};

    try {
      const parsed = JSON.parse(rawInputSchema);
      const normalized = normalizeAndValidateInputSchema(parsed);
      if (!normalized) {
        return {};
      }

      const flatInputs = flattenInputs(normalized);
      return flatInputs.reduce(
        (acc, item) => {
          const values = extractOptionValues(item);
          acc[item.id] = {
            name: item.name,
            type: item.type,
            ...(values && { values }),
          };
          return acc;
        },
        {} as Record<
          string,
          { name: string; type: InputType; values?: string[] }
        >,
      );
    } catch (error) {
      console.error("[inputs] Failed to parse JSON:", error);
      return {};
    }
  }, [rawInputSchema]);

  return (
    <div className="flex flex-col gap-2">
      {Object.keys(input).length > 0 ? (
        <div>
          {Object.entries(input).map(([key, value]) => {
            const schemaEntry = inputsMap[key];
            const label = schemaEntry?.name ?? key;
            const type = schemaEntry?.type ?? InputType.NONE;
            const values = schemaEntry?.values;
            return (
              <div
                className="grid grid-cols-1 items-start gap-4 pb-4 text-base md:grid-cols-3"
                key={key}
              >
                <span className="font-bold break-all md:col-span-1">
                  {label}
                </span>
                <div className="break-all md:col-span-2">
                  {renderInputValue(value, type, blobs, values)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-base">{t("none")}</p>
      )}
      {identifierFromPurchaser && jobType && (
        <>
          <Separator className="my-2" />
          <HashGroupRow
            label={tMeta("inputHash")}
            direction="input"
            jobType={jobType}
            identifierFromPurchaser={identifierFromPurchaser}
            input={rawInput}
            externalHash={inputHash}
            hash={calculatedInputHash}
            tLabelExternal={tMeta("onChain")}
            tLabelHash={tMeta("calculated")}
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
