export enum InputType {
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
export enum InputValidation {
  MIN = "min",
  MAX = "max",
  FORMAT = "format",
  OPTIONAL = "optional",
  MAX_SIZE = "maxSize",
  ACCEPT = "accept",
  STEP = "step",
}

export enum InputFormat {
  URL = "url",
  EMAIL = "email",
  INTEGER = "integer",
  NON_EMPTY = "nonempty",
  TEL_PATTERN = "tel_pattern",
}

export const requiredInputFileValidations = [
  InputValidation.MIN,
  InputValidation.MAX,
  InputValidation.MAX_SIZE,
  InputValidation.ACCEPT,
] as const;

export type RequiredInputFileValidations =
  (typeof requiredInputFileValidations)[number];
