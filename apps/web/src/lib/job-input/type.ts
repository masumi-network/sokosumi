export enum ValidJobInputTypes {
  NONE = "none",
  STRING = "string",
  TEXT = "text",
  TEXTAREA = "textarea",
  NUMBER = "number",
  BOOLEAN = "boolean",
  EMAIL = "email",
  PASSWORD = "password",
  TEL = "tel",
  URL = "url",
  DATE = "date",
  DATETIME = "datetime-local",
  TIME = "time",
  MONTH = "month",
  WEEK = "week",
  COLOR = "color",
  RANGE = "range",
  FILE = "file",
  HIDDEN = "hidden",
  SEARCH = "search",
  CHECKBOX = "checkbox",
  RADIO_GROUP = "radio",
  OPTION = "option",
  MULTISELECT = "multiselect",
}
export enum ValidJobInputValidationTypes {
  MIN = "min",
  MAX = "max",
  FORMAT = "format",
  OPTIONAL = "optional",
  MAX_SIZE = "maxSize",
  ACCEPT = "accept",
  STEP = "step",
}

export enum ValidJobInputFormatValues {
  URL = "url",
  EMAIL = "email",
  INTEGER = "integer",
  NON_EMPTY = "nonempty",
  TEL_PATTERN = "tel_pattern",
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

export type JobInputData = Record<
  string,
  string | string[] | number | boolean | number[] | File | File[] | undefined
>;
