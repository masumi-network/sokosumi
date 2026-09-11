import {
  type InputFieldSchemaType,
  type InputSchemaSchemaType,
  inputGroupsSchema,
  inputSchema,
} from "@sokosumi/masumi/schemas";
import * as z from "zod";

/** Must match Core `createJobRequestSchema` / `patchJobRequestSchema`. */
export const jobDetailsNameFormSchema = (
  t?: IntlTranslation<"Components.Jobs.JobDetails.Header.JobName.Schema">,
) =>
  z.object({
    name: z
      .string({ error: t?.("Name.invalid") })
      .min(2, { error: t?.("Name.min") })
      .or(z.literal("")),
  });

export type JobDetailsNameFormSchemaType = z.infer<
  ReturnType<typeof jobDetailsNameFormSchema>
>;

export const provideJobInputSchema = z.object({
  jobId: z.string(),
  eventId: z.string(),
  inputData: inputSchema,
});

export type ProvideJobInputSchemaType = z.infer<typeof provideJobInputSchema>;

const groupedInputSchema = z.object({ input_groups: inputGroupsSchema });

type GroupedInputSchema = z.infer<typeof groupedInputSchema>;

export function isGroupedSchema(
  schema: InputSchemaSchemaType,
): schema is GroupedInputSchema {
  return groupedInputSchema.safeParse(schema).success;
}

export function flattenInputs(
  schema: InputSchemaSchemaType,
): InputFieldSchemaType[] {
  if (isGroupedSchema(schema)) {
    return schema.input_groups.flatMap((group) => group.input_data);
  }
  return schema.input_data;
}
