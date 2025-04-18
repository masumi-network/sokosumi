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

export type JobInputType = ValidJobInputTypes;
export type JobInputValidationType = ValidJobInputValidationTypes;
export type JobInputFormatValue = ValidJobInputFormatValues;

export type JobInputSchemaIntlPath = "Library.JobInput.Schema";
export type JobInputFormIntlPath = "Library.JobInput.Form";

export type JobInputData = Map<string, string | number | boolean | number[]>;
