import * as z from "zod";
import type { PostAgentsByIdJobsData } from "@/lib/clients/generated/core";
import type { ProvideJobInputSchemaType } from "@/lib/schemas";

export type CoreJobInputData = NonNullable<
  PostAgentsByIdJobsData["body"]
>["inputData"];

/**
 * Same value union as Core create-job / provide-input `inputData` — validate
 * here so Masumi payload (files, etc.) is narrowed to what Core accepts.
 */
const coreJobInputDataSchema = z.record(
  z.string(),
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.array(z.number()),
  ]),
) satisfies z.ZodType<CoreJobInputData>;

export function toCoreJobInputData(
  inputData: ProvideJobInputSchemaType["inputData"],
): CoreJobInputData | null {
  const parsed = coreJobInputDataSchema.safeParse(inputData);
  return parsed.success ? parsed.data : null;
}
