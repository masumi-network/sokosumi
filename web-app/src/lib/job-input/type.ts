export enum ValidJobInputTypes {
  STRING = "string",
  TEXTAREA = "textarea",
  NUMBER = "number",
  BOOLEAN = "boolean",
  OPTION = "option",
  NONE = "none",
  FILE = "file",
}
export enum ValidJobInputValidationTypes {
  MIN = "min",
  MAX = "max",
  FORMAT = "format",
  OPTIONAL = "optional",
  MAX_SIZE = "maxSize",
  ACCEPT = "accept",
}

export enum ValidJobInputFormatValues {
  URL = "url",
  EMAIL = "email",
  INTEGER = "integer",
  NON_EMPTY = "nonempty",
}

export const requiredJobInputFileValidationTypes = [
  ValidJobInputValidationTypes.MIN,
  ValidJobInputValidationTypes.MAX,
  ValidJobInputValidationTypes.MAX_SIZE,
  ValidJobInputValidationTypes.ACCEPT,
] as const;
export type RequiredJobInputFileValidationTypes =
  (typeof requiredJobInputFileValidationTypes)[number];

export type JobInputType = ValidJobInputTypes;
export type JobInputValidationType = ValidJobInputValidationTypes;
export type JobInputFormatValue = ValidJobInputFormatValues;

export type JobInputSchemaIntlPath = "Library.JobInput.Schema";
export type JobInputFormIntlPath = "Library.JobInput.Form";

export type JobInputData = Map<
  string,
  string | string[] | number | boolean | number[] | File | File[] | undefined
>;
