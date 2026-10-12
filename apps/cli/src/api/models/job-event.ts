import { asRecord, nullableString } from "./parse-helpers.js";

export interface JobEvent {
  id: string | null;
  createdAt: string | null;
  status: string | null;
  result: string | null;
}

export function parseJobEvent(input: unknown): JobEvent {
  const value = asRecord(input);
  return {
    id: nullableString(value.id),
    createdAt: nullableString(value.createdAt),
    status: nullableString(value.status),
    result: nullableString(value.result),
  };
}
