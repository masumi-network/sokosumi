export type JobInputSchemaIntlPath = "Library.JobInput.Schema";
export type JobInputFormIntlPath = "Library.JobInput.Form";

export type JobInputData = Record<
  string,
  string | string[] | number | boolean | number[] | File | File[] | undefined
>;
