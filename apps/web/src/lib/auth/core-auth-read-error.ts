export type CoreAuthReadErrorReason =
  | "http"
  | "invalid_json"
  | "network"
  | "timeout";

export interface CoreAuthReadError {
  path: string;
  reason: CoreAuthReadErrorReason;
  status?: number;
}
