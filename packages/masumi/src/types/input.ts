/**
 * Input data type for job inputs.
 * Matches the structure expected by agent APIs.
 */
export type InputData = Record<
  string,
  string | string[] | number | boolean | number[] | File | File[] | undefined
>;
