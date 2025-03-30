export enum ValidJobInputTypes {
  String = "string",
  Number = "number",
  Boolean = "boolean",
  Option = "option",
  None = "none",
}
export enum ValidJobInputValidationTypes {
  Min = "min",
  Max = "max",
  Format = "format",
  Required = "required",
}

export enum ValidJobInputFormatValues {
  Url = "url",
  Email = "email",
  Integer = "integer",
  Nonempty = "nonempty",
}

type JobInputType = ValidJobInputTypes;
type JobInputValidationType = ValidJobInputValidationTypes;
type JobInputFormatValue = ValidJobInputFormatValues;

type JobInputSchemaIntlPath = "Library.JobInput.Schema";
export type {
  JobInputFormatValue,
  JobInputSchemaIntlPath,
  JobInputType,
  JobInputValidationType,
};
