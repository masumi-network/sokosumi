"use client";

import { hashInput } from "@sokosumi/masumi/hash";
import {
  type InputFieldSchemaType,
  normalizeAndValidateInputSchema,
} from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";
import { isUrlArray, isUrlString } from "@sokosumi/utils";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import DefaultErrorBoundary from "@/components/default-error-boundary";
import Markdown from "@/components/markdown";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { flattenInputs } from "@/lib/schemas/job";
import type { JobType } from "@/lib/types/core-dto";
import { cn } from "@/lib/utils";

import { FileChipWithMetadata } from "./file-chip-with-metadata";
import { HashGroupRow } from "./hash-group-row";

interface JobDetailsInputsProps {
  input: string | null;
  inputSchema: string | null;
  inputHash?: string | null;
  identifierFromPurchaser?: string | null;
  jobType?: JobType;
}

export default function JobDetailsInputs({
  input,
  inputSchema,
  inputHash,
  identifierFromPurchaser,
  jobType,
}: JobDetailsInputsProps) {
  return (
    <DefaultErrorBoundary fallback={<JobDetailsInputsError />}>
      <JobDetailsInputsInner
        input={input}
        inputSchema={inputSchema}
        inputHash={inputHash}
        identifierFromPurchaser={identifierFromPurchaser}
        jobType={jobType}
      />
    </DefaultErrorBoundary>
  );
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

function extractTextDefaultValue(
  item: InputFieldSchemaType,
): string | undefined {
  if (item.type === InputType.TEXT || item.type === InputType.TEXTAREA) {
    return item.data?.default ?? undefined;
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

interface BooleanLabels {
  yes: string;
  no: string;
}

function renderInputValue(
  value: unknown,
  type: InputType,
  values: string[] | undefined,
  booleanLabels: BooleanLabels,
) {
  if (
    typeof value === "string" &&
    (type === InputType.STRING ||
      type === InputType.TEXT ||
      type === InputType.TEXTAREA ||
      type === InputType.NONE)
  ) {
    return (
      <Markdown className="text-foreground/80 wrap-break-word">
        {value}
      </Markdown>
    );
  }

  if (type === InputType.FILE) {
    if (isUrlString(value)) {
      return <FileChipWithMetadata url={value} />;
    }
    if (isUrlArray(value)) {
      if (value.length === 0) {
        return <span>{"-"}</span>;
      }
      return (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {value.map((url) => (
            <FileChipWithMetadata key={url} url={url} />
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

  if (type === InputType.BOOLEAN && typeof value === "boolean") {
    return (
      <span className="break-all">
        {value ? booleanLabels.yes : booleanLabels.no}
      </span>
    );
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
  inputHash = null,
  identifierFromPurchaser = null,
  jobType,
}: JobDetailsInputsProps) {
  const t = useTranslations("Components.Jobs.JobDetails.Input");
  const tMeta = useTranslations("Components.Jobs.JobDetails.Meta");
  const [open, setOpen] = useState(false);
  const [isExpandable, setIsExpandable] = useState(false);
  const inputContentRef = useRef<HTMLDivElement | null>(null);

  const input = useMemo<Record<string, unknown>>(() => {
    if (!rawInput) {
      return {};
    }

    return JSON.parse(rawInput) as Record<string, unknown>;
  }, [rawInput]);

  const calculatedInputHash = useMemo(() => {
    if (!identifierFromPurchaser || !rawInput) return null;
    return hashInput(rawInput, identifierFromPurchaser);
  }, [identifierFromPurchaser, rawInput]);

  const inputsMap: Record<
    string,
    { name: string; type: InputType; values?: string[]; defaultValue?: string }
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
          const defaultValue = extractTextDefaultValue(item);
          acc[item.id] = {
            name: item.name,
            type: item.type,
            ...(values && { values }),
            ...(defaultValue !== undefined && { defaultValue }),
          };
          return acc;
        },
        {} as Record<
          string,
          {
            name: string;
            type: InputType;
            values?: string[];
            defaultValue?: string;
          }
        >,
      );
    } catch (error) {
      console.error("[inputs] Failed to parse JSON:", error);
      return {};
    }
  }, [rawInputSchema]);

  const displayInputEntries = useMemo(() => {
    const schemaKeys = new Set(Object.keys(inputsMap));
    const schemaEntries = Object.entries(inputsMap).flatMap(
      ([key, schemaEntry]) => {
        const value = input[key];
        if (value !== undefined) {
          return [[key, value] as const];
        }

        if (schemaEntry.defaultValue !== undefined) {
          return [[key, schemaEntry.defaultValue] as const];
        }

        return [];
      },
    );
    const extraEntries = Object.entries(input).filter(
      ([key]) => !schemaKeys.has(key),
    );

    return [...schemaEntries, ...extraEntries];
  }, [input, inputsMap]);

  useEffect(() => {
    const element = inputContentRef.current;
    if (!element || open || displayInputEntries.length === 0) {
      return;
    }

    const measureOverflow = () => {
      const hasOverflow = element.scrollHeight > element.clientHeight + 1;
      setIsExpandable(hasOverflow);
    };

    measureOverflow();

    const observer = new ResizeObserver(measureOverflow);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [displayInputEntries.length, open, rawInput]);

  const hasInputs = displayInputEntries.length > 0;

  const shouldFade = !open && isExpandable;

  return (
    <div className="flex flex-col gap-2">
      {hasInputs ? (
        <Collapsible open={open} onOpenChange={setOpen}>
          <div className="relative">
            <CollapsibleContent forceMount>
              <div
                ref={inputContentRef}
                className={cn(
                  "space-y-4",
                  !open && "max-h-48 overflow-hidden",
                  shouldFade &&
                    "mask-[linear-gradient(to_bottom,black_60%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_60%,transparent_100%)]",
                )}
              >
                {displayInputEntries.map(([key, value]) => {
                  const schemaEntry = inputsMap[key];
                  const label = schemaEntry?.name ?? key;
                  const type = schemaEntry?.type ?? InputType.NONE;
                  const values = schemaEntry?.values;
                  return (
                    <div
                      className="flex flex-col items-start gap-1 text-base"
                      key={key}
                    >
                      <span className="text-muted-foreground text-sm font-medium">
                        {label}
                      </span>
                      <div className="break-all">
                        {renderInputValue(value, type, values, {
                          yes: t("yes"),
                          no: t("no"),
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CollapsibleContent>

            {shouldFade ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-12 items-end justify-center bg-linear-to-b from-transparent to-transparent">
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="bg-background/80 hover:bg-background pointer-events-auto h-7 rounded-full px-3 text-xs font-semibold backdrop-blur"
                  >
                    {t("expand")}
                  </Button>
                </CollapsibleTrigger>
              </div>
            ) : null}
          </div>

          {open && isExpandable ? (
            <div className="mt-2 flex justify-center">
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-7 rounded-full px-3 text-xs font-semibold"
                >
                  {t("collapse")}
                </Button>
              </CollapsibleTrigger>
            </div>
          ) : null}
        </Collapsible>
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
