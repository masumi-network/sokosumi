const ValidJobInputTypes = [
  "string",
  "number",
  "boolean",
  "option",
  "none",
] as const;
const ValidValidationTypes = ["min", "max", "format", "required"] as const;
const ValidFormatValues = ["url", "email", "integer", "nonempty"] as const;

type JobInputType = (typeof ValidJobInputTypes)[number];
type JobInputValidationType = (typeof ValidValidationTypes)[number];
type JobInputFormatValue = (typeof ValidFormatValues)[number];

type JobInputSchemaIntlPath = "Library.JobInput.Schema";

export { ValidFormatValues, ValidJobInputTypes, ValidValidationTypes };
export type {
  JobInputFormatValue,
  JobInputSchemaIntlPath,
  JobInputType,
  JobInputValidationType,
};
