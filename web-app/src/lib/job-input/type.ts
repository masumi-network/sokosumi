export enum ValidJobInputTypes {
  STRING = "string",
  TEXTAREA = "textarea",
  NUMBER = "number",
  BOOLEAN = "boolean",
  CHECKBOX = "checkbox",
  OPTION = "option",
  NONE = "none",
  FILE = "file",
  DATE = "date",
  DATETIME = "datetime-local",
  TIME = "time",
  RANGE = "range",
  MULTISELECT = "multiselect",
  RADIO_GROUP = "radio",
  PASSWORD = "password",
  EMAIL = "email",
  TEL = "tel",
  URL = "url",
  MONTH = "month",
  WEEK = "week",
  HIDDEN = "hidden",
  SEARCH = "search",
  COLOR = "color",
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

export type JobInputData = Map<
  string,
  string | string[] | number | boolean | number[] | File | File[] | undefined
>;
