export const InputType = {
  NONE: "none",
  STRING: "string",
  TEXT: "text",
  TEXTAREA: "textarea",
  NUMBER: "number",
  BOOLEAN: "boolean",
  EMAIL: "email",
  PASSWORD: "password",
  TEL: "tel",
  URL: "url",
  DATE: "date",
  DATETIME: "datetime-local",
  TIME: "time",
  MONTH: "month",
  WEEK: "week",
  COLOR: "color",
  RANGE: "range",
  FILE: "file",
  HIDDEN: "hidden",
  SEARCH: "search",
  CHECKBOX: "checkbox",
  RADIO_GROUP: "radio",
  OPTION: "option",
  MULTISELECT: "multiselect",
} as const;

export type InputType = (typeof InputType)[keyof typeof InputType];

export const InputValidation = {
  MIN: "min",
  MAX: "max",
  FORMAT: "format",
  OPTIONAL: "optional",
  ACCEPT: "accept",
  STEP: "step",
} as const;

export type InputValidation =
  (typeof InputValidation)[keyof typeof InputValidation];

export const InputFormat = {
  URL: "url",
  EMAIL: "email",
  INTEGER: "integer",
  NON_EMPTY: "nonempty",
  TEL_PATTERN: "tel_pattern",
} as const;

export type InputFormat = (typeof InputFormat)[keyof typeof InputFormat];

export const OutputFormat = {
  URL: "url",
} as const;

export type OutputFormat = (typeof OutputFormat)[keyof typeof OutputFormat];
