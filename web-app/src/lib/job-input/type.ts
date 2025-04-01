export enum ValidJobInputTypes {
  STRING = "string",
  NUMBER = "number",
  BOOLEAN = "boolean",
  OPTION = "option",
  NONE = "none",
}
export enum ValidJobInputValidationTypes {
  MIN = "min",
  MAX = "max",
  FORMAT = "format",
  OPTIONAL = "optional",
}

export enum ValidJobInputFormatValues {
  URL = "url",
  EMAIL = "email",
  INTEGER = "integer",
  NON_EMPTY = "nonempty",
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
